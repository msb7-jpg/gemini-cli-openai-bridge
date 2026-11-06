/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { type CanonicalStreamEvent } from "../../core/gemini/canonical-ir.types.js";
import { recordToolCallSignature } from "../../core/gemini/thought-signature.manager.js";
import { type ProtocolSSEEncoder } from "../../core/sse/sse-pipeline.js";
import { globalQuotaTracker } from "../models-and-quota/quota-tracker.service.js";

interface OpenAIDelta {
  role?: "assistant";
  content?: string | null;
  tool_calls?: {
    index: number;
    id: string;
    type: "function";
    function: {
      name?: string;
      arguments?: string;
    };
  }[];
}

interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: OpenAIDelta;
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

/**
 * Creates a stateful `ProtocolSSEEncoder` that converts `CanonicalStreamEvent` items
 * into OpenAI `chat.completion.chunk` Server-Sent Events.
 *
 * @param model - Requested model identifier included in each chunk.
 * @param debugMode - Whether debug logging is enabled.
 * @returns Stateful `ProtocolSSEEncoder` instance.
 */
export function createOpenAISSEEncoder(model: string, debugMode = false): ProtocolSSEEncoder {
  const chatId = `chatcmpl-${randomUUID()}`;
  const creationTime = Math.floor(Date.now() / 1000);
  let isFirstChunk = true;
  let toolCallIndex = 0;
  let usageData: OpenAIChunk["usage"] = null;

  const formatChunkFrame = (
    delta: OpenAIDelta,
    finishReason: string | null = null,
    usage: OpenAIChunk["usage"] = null,
  ): string => {
    const chunk: OpenAIChunk = {
      id: chatId,
      object: "chat.completion.chunk",
      created: creationTime,
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
        },
      ],
    };
    if (usage) {
      chunk.usage = usage;
    }
    return `data: ${JSON.stringify(chunk)}\n\n`;
  };

  return {
    encodeEvent(chunk: CanonicalStreamEvent): string[] {
      if (debugMode) {
        console.log(
          `[Stream Transformer] Received chunk: ${chunk.type}`,
          chunk.data ? JSON.stringify(chunk.data) : "",
        );
      }

      const frames: string[] = [];
      const delta: OpenAIDelta = {};

      if (isFirstChunk) {
        delta.role = "assistant";
        isFirstChunk = false;
      }

      switch (chunk.type) {
        case "text":
          if (chunk.data) {
            delta.content = chunk.data;
            frames.push(formatChunkFrame(delta));
          }
          break;

        case "tool_code": {
          const { name, args, thoughtSignature } = chunk.data;
          const toolCallId = `call_${name}_${randomUUID()}`;
          recordToolCallSignature(toolCallId, name, thoughtSignature);

          const nameDelta: OpenAIDelta = {
            ...delta,
            tool_calls: [
              {
                index: toolCallIndex,
                id: toolCallId,
                type: "function",
                function: { name, arguments: "" },
              },
            ],
          };
          frames.push(formatChunkFrame(nameDelta));

          const argsDelta: OpenAIDelta = {
            tool_calls: [
              {
                index: toolCallIndex,
                id: toolCallId,
                type: "function",
                function: { arguments: JSON.stringify(args) },
              },
            ],
          };
          frames.push(formatChunkFrame(argsDelta));

          toolCallIndex++;
          break;
        }

        case "reasoning":
          if (debugMode) {
            console.log(`[Stream Transformer] Ignoring chunk: ${chunk.type}`);
          }
          break;

        case "usage":
          if (chunk.data) {
            const prompt = chunk.data.promptTokenCount || 0;
            const completion = chunk.data.candidatesTokenCount || 0;
            const cached = chunk.data.cachedContentTokenCount || 0;
            const total = chunk.data.totalTokenCount || prompt + completion;

            globalQuotaTracker.recordUsage(model, {
              promptTokens: prompt,
              completionTokens: completion,
              cachedTokens: cached,
              totalTokens: total,
            });

            usageData = {
              prompt_tokens: prompt,
              completion_tokens: completion,
              total_tokens: total,
            };
          }
          break;
      }

      return frames;
    },

    flush(): string[] {
      const finishReason = toolCallIndex > 0 ? "tool_calls" : "stop";
      return [formatChunkFrame({}, finishReason, usageData), "data: [DONE]\n\n"];
    },
  };
}
