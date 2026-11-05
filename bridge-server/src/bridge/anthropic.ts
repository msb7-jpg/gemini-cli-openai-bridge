import { Router, Request, Response } from 'express';
import { type Config } from '@google/gemini-cli-core';
import { randomUUID } from 'node:crypto';
import { GeminiApiClient } from '../gemini-client.js';
import {
  type OpenAIMessage,
  type OpenAITool,
  type OpenAIToolCall,
} from '../types.js';
import {
  type AnthropicMessagesRequest,
  type AnthropicMessageResponse,
  type AnthropicMessage,
} from './anthropic-types.js';
import { createAnthropicStreamTransformer } from './anthropic-stream-transformer.js';
import { logger } from '../utils/logger.js';
import {
  thoughtSignatureCache,
  lastThoughtSignatureByTool,
  toolCallNameCache,
} from '../utils/thought-signature-cache.js';
import { resolveModelId, SUPPORTED_MODELS } from '../utils/model-resolver.js';
import { globalQuotaTracker } from '../services/quota-tracker.js';

export function resolveAnthropicModel(requestedModel?: string): string {
  return resolveModelId(requestedModel);
}

export function convertAnthropicMessagesToOpenAI(
  anthropicMessages: AnthropicMessage[],
  system?: AnthropicMessagesRequest['system'],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // 1. Process system prompt
  if (system) {
    if (typeof system === 'string' && system.trim()) {
      result.push({ role: 'system', content: system });
    } else if (Array.isArray(system)) {
      const systemTexts = system
        .map(b => (typeof b === 'string' ? b : b.text))
        .filter(Boolean)
        .join('\n\n');
      if (systemTexts) {
        result.push({ role: 'system', content: systemTexts });
      }
    }
  }

  // 2. Process conversation turns
  for (const msg of anthropicMessages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textBlocks: string[] = [];
        const toolResultMessages: OpenAIMessage[] = [];

        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            textBlocks.push(block.text);
          } else if (block.type === 'tool_result') {
            let contentStr = '';
            if (typeof block.content === 'string') {
              contentStr = block.content;
            } else if (Array.isArray(block.content)) {
              contentStr = block.content
                .map(part => (typeof part === 'string' ? part : part.text || ''))
                .join('\n');
            } else if (block.content) {
              contentStr = JSON.stringify(block.content);
            }

            toolResultMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: contentStr,
            });
          }
        }

        // Add tool results first so they match preceding assistant tool calls
        for (const tr of toolResultMessages) {
          result.push(tr);
        }

        // Then any user text prompt
        if (textBlocks.length > 0) {
          result.push({
            role: 'user',
            content: textBlocks.join('\n'),
          });
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments:
                  typeof block.input === 'string'
                    ? block.input
                    : JSON.stringify(block.input ?? {}),
              },
            });
          }
        }

        result.push({
          role: 'assistant',
          content: textParts.length > 0 ? textParts.join('\n') : null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }
  }

  return result;
}

export function convertAnthropicToolsToOpenAI(
  tools?: AnthropicMessagesRequest['tools'],
): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export function createAnthropicRouter(config: Config, debugMode = false): Router {
  const router = Router();

  // Middleware: Request ID
  router.use((req, res, next) => {
    (req as any).requestId = randomUUID();
    next();
  });

  // POST /messages
  router.post('/messages', async (req: Request, res: Response) => {
    const requestId = (req as any).requestId;
    const startTime = Date.now();
    globalQuotaTracker.recordRequestStart();

    // Inject standard rate limit headers
    const rateHeaders = globalQuotaTracker.getRateLimitHeaders();
    for (const [headerName, headerVal] of Object.entries(rateHeaders)) {
      res.setHeader(headerName, headerVal);
    }

    try {
      const body = req.body as AnthropicMessagesRequest;
      const targetModel = resolveAnthropicModel(body.model);
      const isStream = body.stream !== false;

      logger.info('Anthropic bridge request received', {
        requestId,
        requestedModel: body.model,
        targetModel,
        stream: isStream,
        messageCount: body.messages?.length || 0,
      });
      logger.debug(debugMode, 'Anthropic request body:', { requestId, body });

      const messages = convertAnthropicMessagesToOpenAI(
        body.messages || [],
        body.system,
      );
      const tools = convertAnthropicToolsToOpenAI(body.tools);

      const client = new GeminiApiClient(config, debugMode);

      const geminiStream = await client.sendMessageStream({
        model: targetModel,
        messages,
        tools,
      });

      if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const transformer = createAnthropicStreamTransformer(
          body.model || targetModel,
          debugMode,
        );

        const readableStream = new ReadableStream({
          async start(controller) {
            for await (const chunk of geminiStream) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        });

        const transformedStream = readableStream.pipeThrough(transformer);
        const reader = transformedStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          reader.releaseLock();
        }

        const durationMs = Date.now() - startTime;
        logger.info('Anthropic bridge stream finished', {
          requestId,
          durationMs,
        });
        res.end();
      } else {
        // Non-streaming response
        let textContent = '';
        const toolUseBlocks: AnthropicMessageResponse['content'] = [];
        let promptTokens = 15;
        let completionTokens = 1;

        for await (const chunk of geminiStream) {
          if (chunk.type === 'text' && chunk.data) {
            textContent += chunk.data;
          } else if (chunk.type === 'tool_code') {
            const { name, args, thoughtSignature } = chunk.data;
            const toolCallId = `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
            toolCallNameCache.set(toolCallId, name);
            if (thoughtSignature) {
              thoughtSignatureCache.set(toolCallId, thoughtSignature);
              lastThoughtSignatureByTool.set(name, thoughtSignature);
            }
            toolUseBlocks.push({
              type: 'tool_use',
              id: toolCallId,
              name,
              input: (args as Record<string, unknown>) ?? {},
            });
          } else if (chunk.type === 'usage' && chunk.data) {
            promptTokens = chunk.data.promptTokenCount || promptTokens;
            completionTokens = chunk.data.candidatesTokenCount || completionTokens;
            const cached = chunk.data.cachedContentTokenCount || 0;
            const total = chunk.data.totalTokenCount || (promptTokens + completionTokens);

            globalQuotaTracker.recordUsage(body.model || targetModel, {
              promptTokens,
              completionTokens,
              cachedTokens: cached,
              totalTokens: total,
            });
          }
        }

        const contentBlocks: AnthropicMessageResponse['content'] = [];
        if (textContent) {
          contentBlocks.push({ type: 'text', text: textContent });
        }
        contentBlocks.push(...toolUseBlocks);

        const responsePayload: AnthropicMessageResponse = {
          id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          type: 'message',
          role: 'assistant',
          model: body.model || targetModel,
          content: contentBlocks,
          stop_reason: toolUseBlocks.length > 0 ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: promptTokens,
            output_tokens: Math.max(completionTokens, Math.ceil(textContent.length / 4), 1),
          },
        };

        const durationMs = Date.now() - startTime;
        logger.info('Anthropic bridge non-streaming finished', {
          requestId,
          durationMs,
        });
        res.json(responsePayload);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('Error handling Anthropic request', {
        requestId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });

      // Track quota/rate-limit error if applicable
      globalQuotaTracker.recordQuotaError(error);

      if (!res.headersSent) {
        res.status(500).json({
          type: 'error',
          error: {
            type: 'api_error',
            message: error instanceof Error ? error.message : 'Internal server error',
          },
        });
      } else {
        res.end();
      }
    }
  });

  // POST /messages/count_tokens
  router.post('/messages/count_tokens', (req: Request, res: Response) => {
    const body = req.body as AnthropicMessagesRequest;
    let approxChars = 0;

    if (body.system) {
      approxChars += typeof body.system === 'string' ? body.system.length : 100;
    }
    for (const msg of body.messages || []) {
      if (typeof msg.content === 'string') {
        approxChars += msg.content.length;
      }
    }

    res.json({
      input_tokens: Math.max(Math.ceil(approxChars / 4), 10),
    });
  });

  // GET /models
  router.get('/models', (_req: Request, res: Response) => {
    res.json({
      data: SUPPORTED_MODELS,
    });
  });

  return router;
}
