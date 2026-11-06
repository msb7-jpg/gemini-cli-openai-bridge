/**
 * @license
 * Copyright 2025 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { type Config } from "@google/gemini-cli-core";
import { randomUUID } from "node:crypto";
import { GeminiApiClient } from "../gemini-client.js";
import { type OpenAIMessage, type OpenAITool, type OpenAIToolCall } from "../types.js";
import {
  type AnthropicMessagesRequest,
  type AnthropicMessageResponse,
  type AnthropicMessage,
} from "./anthropic-types.js";
import { AnthropicMessagesRequestSchema } from "../schemas/anthropic.js";
import { createAnthropicStreamTransformer } from "./anthropic-stream-transformer.js";
import { logger } from "../utils/logger.js";
import {
  thoughtSignatureCache,
  lastThoughtSignatureByTool,
  toolCallNameCache,
} from "../utils/thought-signature-cache.js";
import { resolveModelId, SUPPORTED_MODELS } from "../utils/model-resolver.js";
import { globalQuotaTracker } from "../services/quota-tracker.js";

export function resolveAnthropicModel(requestedModel?: string): string {
  return resolveModelId(requestedModel);
}

export function convertAnthropicMessagesToOpenAI(
  anthropicMessages: AnthropicMessage[],
  system?: AnthropicMessagesRequest["system"],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // 1. Process system prompt
  if (system) {
    if (typeof system === "string" && system.trim()) {
      result.push({ role: "system", content: system });
    } else if (Array.isArray(system)) {
      const systemTexts = system
        .map((block) => (typeof block === "string" ? block : block.text))
        .filter(Boolean)
        .join("\n\n");
      if (systemTexts) {
        result.push({ role: "system", content: systemTexts });
      }
    }
  }

  // 2. Process conversation turns
  for (const msg of anthropicMessages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textBlocks: string[] = [];
        const toolResultMessages: OpenAIMessage[] = [];

        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            textBlocks.push(block.text);
          } else if (block.type === "tool_result") {
            let contentStr = "";
            if (typeof block.content === "string") {
              contentStr = block.content;
            } else if (Array.isArray(block.content)) {
              contentStr = block.content
                .map((part) => (typeof part === "string" ? part : part.text || ""))
                .join("\n");
            } else if (block.content) {
              contentStr = JSON.stringify(block.content);
            }

            toolResultMessages.push({
              role: "tool",
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
            role: "user",
            content: textBlocks.join("\n"),
          });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        result.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments:
                  typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
              },
            });
          }
        }

        result.push({
          role: "assistant",
          content: textParts.length > 0 ? textParts.join("\n") : null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }
  }

  return result;
}

export function convertAnthropicToolsToOpenAI(
  tools?: AnthropicMessagesRequest["tools"],
): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

export async function registerAnthropicRoutes(
  app: FastifyInstance,
  config: Config,
  debugMode = false,
): Promise<void> {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const requestId = randomUUID();
    const startTime = Date.now();
    globalQuotaTracker.recordRequestStart();

    // Inject standard rate limit headers
    const rateHeaders = globalQuotaTracker.getRateLimitHeaders();
    for (const [headerName, headerVal] of Object.entries(rateHeaders)) {
      reply.header(headerName, headerVal);
    }

    try {
      const body = req.body as AnthropicMessagesRequest;
      const targetModel = resolveAnthropicModel(body.model);
      const isStream = body.stream !== false;

      logger.info("Anthropic bridge request received", {
        requestId,
        requestedModel: body.model,
        targetModel,
        stream: isStream,
        messageCount: body.messages?.length || 0,
      });
      logger.debug(debugMode, "Anthropic request body:", { requestId, body });

      const messages = convertAnthropicMessagesToOpenAI(body.messages || [], body.system);
      const tools = convertAnthropicToolsToOpenAI(body.tools);

      const client = new GeminiApiClient(config, debugMode);

      const geminiStream = await client.sendMessageStream({
        model: targetModel,
        messages,
        tools,
      });

      if (isStream) {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const rawResponse = reply.raw as { flushHeaders?: () => void };
        if (typeof rawResponse.flushHeaders === "function") {
          rawResponse.flushHeaders();
        }

        let isClientAborted = false;
        req.raw.on("close", () => {
          isClientAborted = true;
        });

        const transformer = createAnthropicStreamTransformer(body.model || targetModel, debugMode);

        const readableStream = new ReadableStream({
          async start(controller) {
            for await (const chunk of geminiStream) {
              if (isClientAborted) {
                break;
              }
              controller.enqueue(chunk);
            }
            controller.close();
          },
        });

        const transformedStream = readableStream.pipeThrough(transformer);
        const reader = transformedStream.getReader();

        try {
          while (true) {
            if (isClientAborted) {
              break;
            }
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(value);
          }
        } finally {
          reader.releaseLock();
        }

        const durationMs = Date.now() - startTime;
        logger.info("Anthropic bridge stream finished", {
          requestId,
          durationMs,
        });
        reply.raw.end();
        return reply;
      } else {
        // Non-streaming response
        let textContent = "";
        const toolUseBlocks: AnthropicMessageResponse["content"] = [];
        let promptTokens = 15;
        let completionTokens = 1;

        for await (const chunk of geminiStream) {
          if (chunk.type === "text" && chunk.data) {
            textContent += chunk.data;
          } else if (chunk.type === "tool_code") {
            const { name, args, thoughtSignature } = chunk.data;
            const toolCallId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
            toolCallNameCache.set(toolCallId, name);
            if (thoughtSignature) {
              thoughtSignatureCache.set(toolCallId, thoughtSignature);
              lastThoughtSignatureByTool.set(name, thoughtSignature);
            }
            toolUseBlocks.push({
              type: "tool_use",
              id: toolCallId,
              name,
              input: (args as Record<string, unknown>) ?? {},
            });
          } else if (chunk.type === "usage" && chunk.data) {
            promptTokens = chunk.data.promptTokenCount || promptTokens;
            completionTokens = chunk.data.candidatesTokenCount || completionTokens;
            const cached = chunk.data.cachedContentTokenCount || 0;
            const total = chunk.data.totalTokenCount || promptTokens + completionTokens;

            globalQuotaTracker.recordUsage(body.model || targetModel, {
              promptTokens,
              completionTokens,
              cachedTokens: cached,
              totalTokens: total,
            });
          }
        }

        const contentBlocks: AnthropicMessageResponse["content"] = [];
        if (textContent) {
          contentBlocks.push({ type: "text", text: textContent });
        }
        contentBlocks.push(...toolUseBlocks);

        const responsePayload: AnthropicMessageResponse = {
          id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          type: "message",
          role: "assistant",
          model: body.model || targetModel,
          content: contentBlocks,
          stop_reason: toolUseBlocks.length > 0 ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: promptTokens,
            output_tokens: Math.max(completionTokens, Math.ceil(textContent.length / 4), 1),
          },
        };

        const durationMs = Date.now() - startTime;
        logger.info("Anthropic bridge non-streaming finished", {
          requestId,
          durationMs,
        });
        return reply.status(200).send(responsePayload);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error("Error handling Anthropic request", {
        requestId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });

      // Track quota/rate-limit error if applicable
      globalQuotaTracker.recordQuotaError(error);

      if (!reply.raw.headersSent) {
        return reply.status(500).send({
          type: "error",
          error: {
            type: "api_error",
            message: error instanceof Error ? error.message : "Internal server error",
          },
        });
      } else {
        reply.raw.end();
        return reply;
      }
    }
  };

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // POST /v1/messages and /messages
  typedApp.post(
    "/v1/messages",
    {
      schema: {
        body: AnthropicMessagesRequestSchema,
      },
    },
    handler,
  );

  typedApp.post(
    "/messages",
    {
      schema: {
        body: AnthropicMessagesRequestSchema,
      },
    },
    handler,
  );

  // POST /v1/messages/count_tokens and /messages/count_tokens
  const countTokensHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as AnthropicMessagesRequest;
    let approxChars = 0;

    if (body?.system) {
      approxChars += typeof body.system === "string" ? body.system.length : 100;
    }
    for (const msg of body?.messages || []) {
      if (typeof msg.content === "string") {
        approxChars += msg.content.length;
      }
    }

    return reply.send({
      input_tokens: Math.max(Math.ceil(approxChars / 4), 10),
    });
  };

  app.post("/v1/messages/count_tokens", countTokensHandler);
  app.post("/messages/count_tokens", countTokensHandler);

  // GET /v1/models and /models
  const modelsHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      data: SUPPORTED_MODELS,
    });
  };

  // If /v1/models and /models are not already registered by OpenAI router, register them
  if (!app.hasRoute({ method: "GET", url: "/v1/models" })) {
    app.get("/v1/models", modelsHandler);
  }
  if (!app.hasRoute({ method: "GET", url: "/models" })) {
    app.get("/models", modelsHandler);
  }
}
