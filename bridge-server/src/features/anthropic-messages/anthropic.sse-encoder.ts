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

function formatAnthropicEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Creates a stateful `ProtocolSSEEncoder` that converts `CanonicalStreamEvent` items
 * into Anthropic SSE frames (`message_start`, `content_block_start`, `content_block_delta`,
 * `content_block_stop`, `message_delta`, `message_stop`).
 *
 * @param model - Model identifier reported in the `message_start` event.
 * @param debugMode - Whether debug logging is enabled.
 * @returns Stateful `ProtocolSSEEncoder` instance.
 */
export function createAnthropicSSEEncoder(model: string, debugMode = false): ProtocolSSEEncoder {
  const messageId = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  let isFirst = true;
  let nextBlockIndex = 0;
  let activeTextBlockIndex: number | null = null;
  let hasToolCalls = false;
  let totalOutputTokens = 0;
  let finalOutputTokens: number | null = null;

  const createMessageStartFrame = (): string =>
    formatAnthropicEvent("message_start", {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 1,
        },
      },
    });

  return {
    encodeEvent(chunk: CanonicalStreamEvent): string[] {
      if (debugMode) {
        console.log(
          `[Anthropic Stream Transformer] Received chunk: ${chunk.type}`,
          chunk.data ? JSON.stringify(chunk.data) : "",
        );
      }

      const frames: string[] = [];

      if (isFirst) {
        frames.push(createMessageStartFrame());
        isFirst = false;
      }

      switch (chunk.type) {
        case "text": {
          if (!chunk.data) break;

          if (activeTextBlockIndex === null) {
            activeTextBlockIndex = nextBlockIndex++;
            frames.push(
              formatAnthropicEvent("content_block_start", {
                type: "content_block_start",
                index: activeTextBlockIndex,
                content_block: {
                  type: "text",
                  text: "",
                },
              }),
            );
          }

          totalOutputTokens += Math.ceil(chunk.data.length / 4);
          frames.push(
            formatAnthropicEvent("content_block_delta", {
              type: "content_block_delta",
              index: activeTextBlockIndex,
              delta: {
                type: "text_delta",
                text: chunk.data,
              },
            }),
          );
          break;
        }

        case "tool_code": {
          const { name, args, thoughtSignature } = chunk.data;

          if (activeTextBlockIndex !== null) {
            frames.push(
              formatAnthropicEvent("content_block_stop", {
                type: "content_block_stop",
                index: activeTextBlockIndex,
              }),
            );
            activeTextBlockIndex = null;
          }

          const toolCallId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
          recordToolCallSignature(toolCallId, name, thoughtSignature);

          const toolBlockIndex = nextBlockIndex++;
          hasToolCalls = true;

          frames.push(
            formatAnthropicEvent("content_block_start", {
              type: "content_block_start",
              index: toolBlockIndex,
              content_block: {
                type: "tool_use",
                id: toolCallId,
                name,
                input: {},
              },
            }),
            formatAnthropicEvent("content_block_delta", {
              type: "content_block_delta",
              index: toolBlockIndex,
              delta: {
                type: "input_json_delta",
                partial_json: JSON.stringify(args || {}),
              },
            }),
            formatAnthropicEvent("content_block_stop", {
              type: "content_block_stop",
              index: toolBlockIndex,
            }),
          );
          break;
        }

        case "reasoning":
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

            if (completion > 0) {
              finalOutputTokens = completion;
            }
          }
          break;
      }

      return frames;
    },

    flush(): string[] {
      const frames: string[] = [];

      if (isFirst) {
        frames.push(createMessageStartFrame());
      }

      if (activeTextBlockIndex !== null) {
        frames.push(
          formatAnthropicEvent("content_block_stop", {
            type: "content_block_stop",
            index: activeTextBlockIndex,
          }),
        );
        activeTextBlockIndex = null;
      }

      frames.push(
        formatAnthropicEvent("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: hasToolCalls ? "tool_use" : "end_turn",
            stop_sequence: null,
          },
          usage: {
            output_tokens: finalOutputTokens ?? Math.max(totalOutputTokens, 1),
          },
        }),
        formatAnthropicEvent("message_stop", {
          type: "message_stop",
        }),
      );

      return frames;
    },
  };
}
