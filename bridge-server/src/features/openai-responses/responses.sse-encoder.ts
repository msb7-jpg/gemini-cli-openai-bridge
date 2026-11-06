/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { type CanonicalStreamEvent } from "../../core/gemini/canonical-ir.types.js";
import { type ProtocolSSEEncoder } from "../../core/sse/sse-pipeline.js";
import { logger } from "../../shared/logger.js";

function formatResponsesFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Creates a stateful `ProtocolSSEEncoder` that converts `CanonicalStreamEvent` items
 * into OpenAI Codex `/v1/responses` SSE events (`response.created`, `response.output_item.added`,
 * `response.output_text.delta`, `response.function_call_arguments.delta`, `response.completed`).
 *
 * @param debugMode - Whether debug logging is enabled.
 * @returns Stateful `ProtocolSSEEncoder` instance.
 */
export function createResponsesSSEEncoder(debugMode = false): ProtocolSSEEncoder {
  const responseId = `res_${randomUUID()}`;
  let hasSentCreated = false;
  let isFirstText = true;
  let fullText = "";

  let currentOutputIndex = 0;
  let currentMsgId = `msg_${randomUUID()}`;
  let contentIndex = 0;

  const closeActiveTextBlock = (): string[] => {
    const frames = [
      formatResponsesFrame({
        type: "response.content_part.done",
        item_id: currentMsgId,
        output_index: currentOutputIndex,
        content_index: contentIndex,
        part: { type: "text", text: fullText },
      }),
      formatResponsesFrame({
        type: "response.output_item.done",
        output_index: currentOutputIndex,
        item: {
          id: currentMsgId,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: fullText }],
        },
      }),
    ];
    contentIndex++;
    currentOutputIndex++;
    isFirstText = true;
    fullText = "";
    currentMsgId = `msg_${randomUUID()}`;
    return frames;
  };

  return {
    encodeEvent(chunk: CanonicalStreamEvent): string[] {
      const frames: string[] = [];

      if (!hasSentCreated) {
        frames.push(
          formatResponsesFrame({
            type: "response.created",
            response: { id: responseId, status: "in_progress" },
          }),
        );
        hasSentCreated = true;
      }

      logger.debug(debugMode, "Responses API chunk", { type: chunk.type });

      if (chunk.type === "text" && chunk.data) {
        logger.debug(debugMode, "Text chunk:", chunk.data);
        if (isFirstText) {
          frames.push(
            formatResponsesFrame({
              type: "response.output_item.added",
              output_index: currentOutputIndex,
              item: { id: currentMsgId, type: "message", role: "assistant", content: [] },
            }),
            formatResponsesFrame({
              type: "response.content_part.added",
              item_id: currentMsgId,
              output_index: currentOutputIndex,
              content_index: contentIndex,
              part: { type: "text", text: "" },
            }),
          );
          isFirstText = false;
        }
        fullText += chunk.data;
        frames.push(
          formatResponsesFrame({
            type: "response.output_text.delta",
            item_id: currentMsgId,
            output_index: currentOutputIndex,
            content_index: contentIndex,
            delta: chunk.data,
          }),
        );
      } else if (chunk.type === "tool_code" && chunk.data) {
        if (!isFirstText) {
          frames.push(...closeActiveTextBlock());
        }

        const toolCallName = chunk.data.name;
        const toolCallArgs = JSON.stringify(chunk.data.args);
        const activeToolCallId = `call_${randomUUID()}`;
        const toolCallItemId = `item_${randomUUID()}`;

        frames.push(
          formatResponsesFrame({
            type: "response.output_item.added",
            output_index: currentOutputIndex,
            item: {
              id: toolCallItemId,
              type: "function_call",
              name: toolCallName,
              call_id: activeToolCallId,
            },
          }),
          formatResponsesFrame({
            type: "response.function_call_arguments.delta",
            item_id: toolCallItemId,
            output_index: currentOutputIndex,
            call_id: activeToolCallId,
            delta: toolCallArgs,
          }),
          formatResponsesFrame({
            type: "response.function_call_arguments.done",
            item_id: toolCallItemId,
            output_index: currentOutputIndex,
            call_id: activeToolCallId,
            arguments: toolCallArgs,
          }),
          formatResponsesFrame({
            type: "response.output_item.done",
            output_index: currentOutputIndex,
            item: {
              id: toolCallItemId,
              type: "function_call",
              name: toolCallName,
              call_id: activeToolCallId,
              arguments: toolCallArgs,
            },
          }),
        );

        currentOutputIndex++;
      }

      return frames;
    },

    flush(): string[] {
      const frames: string[] = [];

      if (!hasSentCreated) {
        frames.push(
          formatResponsesFrame({
            type: "response.created",
            response: { id: responseId, status: "in_progress" },
          }),
        );
        hasSentCreated = true;
      }

      if (!isFirstText) {
        frames.push(...closeActiveTextBlock());
      }

      frames.push(
        formatResponsesFrame({
          type: "response.completed",
          response: { id: responseId, status: "completed" },
        }),
        "data: [DONE]\n\n",
      );

      return frames;
    },
  };
}
