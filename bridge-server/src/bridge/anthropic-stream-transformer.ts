import { randomUUID } from "node:crypto";
import {
  thoughtSignatureCache,
  lastThoughtSignatureByTool,
  toolCallNameCache,
} from "../utils/thought-signature-cache.js";
import { type StreamChunk } from "../types.js";
import { globalQuotaTracker } from "../services/quota-tracker.js";

export function createAnthropicStreamTransformer(
  model: string,
  debugMode = false,
): TransformStream<StreamChunk, Uint8Array> {
  const messageId = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const encoder = new TextEncoder();

  let isFirst = true;
  let nextBlockIndex = 0;
  let activeTextBlockIndex: number | null = null;
  let hasToolCalls = false;
  let totalOutputTokens = 0;
  let finalOutputTokens: number | null = null;

  const sendEvent = (
    controller: TransformStreamDefaultController<Uint8Array>,
    event: string,
    data: unknown,
  ) => {
    const sse = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(encoder.encode(sse));
  };

  return new TransformStream({
    transform(chunk: StreamChunk, controller) {
      if (debugMode) {
        console.log(
          `[Anthropic Stream Transformer] Received chunk: ${chunk.type}`,
          chunk.data ? JSON.stringify(chunk.data) : "",
        );
      }

      if (isFirst) {
        sendEvent(controller, "message_start", {
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
        isFirst = false;
      }

      switch (chunk.type) {
        case "text": {
          if (!chunk.data) break;

          // If no active text block, start one
          if (activeTextBlockIndex === null) {
            activeTextBlockIndex = nextBlockIndex++;
            sendEvent(controller, "content_block_start", {
              type: "content_block_start",
              index: activeTextBlockIndex,
              content_block: {
                type: "text",
                text: "",
              },
            });
          }

          totalOutputTokens += Math.ceil(chunk.data.length / 4);
          sendEvent(controller, "content_block_delta", {
            type: "content_block_delta",
            index: activeTextBlockIndex,
            delta: {
              type: "text_delta",
              text: chunk.data,
            },
          });
          break;
        }

        case "tool_code": {
          const { name, args, thoughtSignature } = chunk.data;

          // If there is an open text block, close it before tool call block
          if (activeTextBlockIndex !== null) {
            sendEvent(controller, "content_block_stop", {
              type: "content_block_stop",
              index: activeTextBlockIndex,
            });
            activeTextBlockIndex = null;
          }

          const toolCallId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
          toolCallNameCache.set(toolCallId, name);
          if (thoughtSignature) {
            thoughtSignatureCache.set(toolCallId, thoughtSignature);
            lastThoughtSignatureByTool.set(name, thoughtSignature);
          }

          const toolBlockIndex = nextBlockIndex++;
          hasToolCalls = true;

          sendEvent(controller, "content_block_start", {
            type: "content_block_start",
            index: toolBlockIndex,
            content_block: {
              type: "tool_use",
              id: toolCallId,
              name,
              input: {},
            },
          });

          const argsJson = JSON.stringify(args || {});
          sendEvent(controller, "content_block_delta", {
            type: "content_block_delta",
            index: toolBlockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: argsJson,
            },
          });

          sendEvent(controller, "content_block_stop", {
            type: "content_block_stop",
            index: toolBlockIndex,
          });
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
    },

    flush(controller) {
      if (isFirst) {
        // In case nothing was sent at all
        sendEvent(controller, "message_start", {
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
      }

      if (activeTextBlockIndex !== null) {
        sendEvent(controller, "content_block_stop", {
          type: "content_block_stop",
          index: activeTextBlockIndex,
        });
        activeTextBlockIndex = null;
      }

      sendEvent(controller, "message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: hasToolCalls ? "tool_use" : "end_turn",
          stop_sequence: null,
        },
        usage: {
          output_tokens: finalOutputTokens ?? Math.max(totalOutputTokens, 1),
        },
      });

      sendEvent(controller, "message_stop", {
        type: "message_stop",
      });
    },
  });
}
