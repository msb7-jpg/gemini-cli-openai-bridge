/**
 * @license
 * Copyright 2025 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */
import { FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { type Config } from "@google/gemini-cli-core";
import { createOpenAIStreamTransformer } from "./stream-transformer.js";
import { GeminiApiClient } from "../gemini-client.js";
import {
  type OpenAIChatCompletion,
  type OpenAIChatCompletionMessage,
  type OpenAIChatCompletionChoice,
  type OpenAIToolCall,
  type OpenAIChatCompletionRequest,
} from "../types.js";
import { OpenAIChatCompletionRequestSchema } from "../schemas/openai.js";
import { mapErrorToOpenAIError } from "../utils/error-mapper.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "node:crypto";
import {
  thoughtSignatureCache,
  lastThoughtSignatureByTool,
  toolCallNameCache,
} from "../utils/thought-signature-cache.js";
import { resolveModelId, SUPPORTED_MODELS } from "../utils/model-resolver.js";
import { globalQuotaTracker } from "../services/quota-tracker.js";

export async function registerOpenAIRoutes(
  app: FastifyInstance,
  config: Config,
  debugMode = false,
): Promise<void> {
  const handler = async (
    req: FastifyRequest<{ Body: OpenAIChatCompletionRequest }>,
    reply: FastifyReply,
  ) => {
    const requestId = randomUUID();
    const startTime = Date.now();
    globalQuotaTracker.recordRequestStart();

    // Inject standard rate limit headers
    const rateHeaders = globalQuotaTracker.getRateLimitHeaders();
    for (const [headerName, headerVal] of Object.entries(rateHeaders)) {
      reply.header(headerName, headerVal);
    }

    try {
      const body = req.body as OpenAIChatCompletionRequest;
      const resolvedModel = resolveModelId(body.model);

      logger.info("OpenAI bridge request received", {
        requestId,
        model: body.model,
        resolvedModel,
        stream: body.stream,
      });
      logger.debug(debugMode, "Request body:", { requestId, body, resolvedModel });
      const stream = body.stream !== false;

      const client = new GeminiApiClient(config, debugMode);

      const geminiStream = await client.sendMessageStream({
        model: resolvedModel,
        messages: body.messages,
        tools: body.tools,
        tool_choice: body.tool_choice,
      });

      if (stream) {
        // --- Streaming Response using raw response ---
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const rawReply = reply.raw as { flushHeaders?: () => void };
        if (typeof rawReply.flushHeaders === "function") {
          rawReply.flushHeaders();
        }

        let isClientAborted = false;
        req.raw.on("close", () => {
          isClientAborted = true;
        });

        const openAIStream = createOpenAIStreamTransformer(body.model, debugMode);

        const readableStream = new ReadableStream({
          async start(controller) {
            for await (const value of geminiStream) {
              if (isClientAborted) {
                break;
              }
              controller.enqueue(value);
            }
            controller.close();
          },
        });

        const transformedStream = readableStream.pipeThrough(openAIStream);
        const reader = transformedStream.getReader();

        try {
          while (true) {
            if (isClientAborted) {
              break;
            }
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            reply.raw.write(value);
          }
        } finally {
          reader.releaseLock();
        }

        const durationMs = Date.now() - startTime;
        logger.info("OpenAI bridge request finished", {
          requestId,
          status: "success",
          durationMs,
        });
        reply.raw.end();
        return reply;
      } else {
        // --- Non-streaming logic ---
        let fullTextContent = "";
        const toolCalls: OpenAIToolCall[] = [];
        let finishReason: OpenAIChatCompletionChoice["finish_reason"] = "stop";
        let recordedUsage: OpenAIChatCompletion["usage"] | undefined = undefined;

        for await (const chunk of geminiStream) {
          if (chunk.type === "text" && chunk.data) {
            fullTextContent += chunk.data;
          } else if (chunk.type === "tool_code" && chunk.data) {
            const toolCallId = `call_${chunk.data.name}_${randomUUID()}`;
            toolCallNameCache.set(toolCallId, chunk.data.name);
            if (chunk.data.thoughtSignature) {
              thoughtSignatureCache.set(toolCallId, chunk.data.thoughtSignature);
              lastThoughtSignatureByTool.set(chunk.data.name, chunk.data.thoughtSignature);
            }
            toolCalls.push({
              id: toolCallId,
              type: "function",
              function: {
                name: chunk.data.name,
                arguments: JSON.stringify(chunk.data.args),
              },
            });
          } else if (chunk.type === "usage" && chunk.data) {
            const prompt = chunk.data.promptTokenCount || 0;
            const completion = chunk.data.candidatesTokenCount || 0;
            const cached = chunk.data.cachedContentTokenCount || 0;
            const total = chunk.data.totalTokenCount || prompt + completion;

            globalQuotaTracker.recordUsage(body.model, {
              promptTokens: prompt,
              completionTokens: completion,
              cachedTokens: cached,
              totalTokens: total,
            });

            recordedUsage = {
              prompt_tokens: prompt,
              completion_tokens: completion,
              total_tokens: total,
            };
          }
        }

        if (toolCalls.length > 0) {
          finishReason = "tool_calls";
        }

        const assistantMessage: OpenAIChatCompletionMessage = {
          role: "assistant",
          content: fullTextContent || null,
        };

        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }

        const finalResponse: OpenAIChatCompletion = {
          id: `chatcmpl-${randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(startTime / 1000),
          model: body.model,
          choices: [
            {
              index: 0,
              message: assistantMessage,
              finish_reason: finishReason,
            },
          ],
          usage: recordedUsage,
        };

        const durationMs = Date.now() - startTime;
        logger.info("OpenAI bridge non-streaming request finished", {
          requestId,
          status: "success",
          durationMs,
        });

        return reply.status(200).send(finalResponse);
      }
    } catch (e: unknown) {
      const durationMs = Date.now() - startTime;
      logger.error("OpenAI bridge request failed", e as Error, {
        requestId,
        durationMs,
      });

      globalQuotaTracker.recordQuotaError(e);

      const { openAIError, statusCode } = mapErrorToOpenAIError(e);

      if (!reply.raw.headersSent) {
        return reply.status(statusCode).send(openAIError);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ error: openAIError.error })}\n\n`);
        reply.raw.end();
        return reply;
      }
    }
  };

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Register /v1/chat/completions and alias /chat/completions
  typedApp.post(
    "/v1/chat/completions",
    {
      schema: {
        body: OpenAIChatCompletionRequestSchema,
      },
    },
    handler,
  );

  typedApp.post(
    "/chat/completions",
    {
      schema: {
        body: OpenAIChatCompletionRequestSchema,
      },
    },
    handler,
  );

  // The /v1/models and /models endpoint
  const modelsHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      object: "list",
      data: SUPPORTED_MODELS,
    });
  };

  app.get("/v1/models", modelsHandler);
  app.get("/models", modelsHandler);
}
