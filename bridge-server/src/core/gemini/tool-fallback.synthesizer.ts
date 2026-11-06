/**
 * @license
 * Copyright 2025-2026 Google LLC / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Part } from "@google/genai";
import { logger } from "../../shared/logger.js";
import { toolCallNameCache } from "./thought-signature.manager.js";

export interface IndexedToolCall {
  id: string;
  name: string;
}

export interface RawToolResultItem {
  toolCallId?: string;
  name?: string;
  content: unknown;
}

/**
 * Parses the function name from a tool call ID (`call_{functionName}_{uuid}`).
 * @param toolCallId - The tool call identifier.
 * @returns The parsed function name or fallback string.
 */
export function parseFunctionNameFromId(toolCallId: string): string {
  if (!toolCallId) return "unknown_tool";
  const parts = toolCallId.split("_");
  if (parts.length > 2 && parts[0] === "call") {
    return parts.slice(1, parts.length - 1).join("_");
  }
  return "unknown_tool_from_id";
}

/**
 * Formats tool response content into a standard record payload suitable for Gemini `functionResponse`.
 * @param content - The raw response content.
 * @returns An object payload suitable for Gemini `functionResponse`.
 */
function formatResponsePayload(content: unknown): Record<string, unknown> {
  if (content === null || content === undefined) {
    return { output: null };
  }
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { output: parsed };
    } catch {
      return { output: content };
    }
  }
  if (typeof content === "object" && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }
  return { output: content };
}

/**
 * Matches a batch of tool result items against preceding assistant tool calls in exact order,
 * synthesizing fallback responses when the client omits a tool result so Gemini tool call parity holds.
 *
 * @param toolResults - Consecutive tool result items from the conversation.
 * @param precedingToolCalls - Tool calls from the immediately preceding assistant turn.
 * @param toolCallMap - Global map of toolCallId to tool call metadata across the conversation.
 * @returns Ordered array of Gemini `functionResponse` parts.
 */
export function buildParityToolResponseParts(
  toolResults: RawToolResultItem[],
  precedingToolCalls: IndexedToolCall[],
  toolCallMap: Map<string, IndexedToolCall>,
): Part[] {
  const functionResponseParts: Part[] = [];
  const toolMsgByCallId = new Map<string, RawToolResultItem>();
  const unconsumedToolMsgs: RawToolResultItem[] = [];

  for (const toolResult of toolResults) {
    if (toolResult.toolCallId) {
      toolMsgByCallId.set(toolResult.toolCallId, toolResult);
    } else {
      unconsumedToolMsgs.push(toolResult);
    }
  }

  if (precedingToolCalls.length > 0) {
    for (const call of precedingToolCalls) {
      const matchingMsg = toolMsgByCallId.get(call.id);
      if (matchingMsg) {
        toolMsgByCallId.delete(call.id);
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: formatResponsePayload(matchingMsg.content),
          },
        });
      } else {
        const matchIdx = unconsumedToolMsgs.findIndex(
          (unconsumedMsg) => unconsumedMsg.name === call.name,
        );
        if (matchIdx !== -1) {
          const [matchedMsg] = unconsumedToolMsgs.splice(matchIdx, 1);
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: formatResponsePayload(matchedMsg.content),
            },
          });
        } else {
          logger.warn(
            `Synthesizing missing response for tool call ${call.id} (${call.name}) to ensure Gemini tool call parity`,
          );
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { error: "No response provided for this tool call" },
            },
          });
        }
      }
    }
  }

  for (const remaining of toolMsgByCallId.values()) {
    const callId = remaining.toolCallId!;
    const funcName =
      toolCallMap.get(callId)?.name ||
      remaining.name ||
      toolCallNameCache.get(callId) ||
      parseFunctionNameFromId(callId);
    functionResponseParts.push({
      functionResponse: {
        name: funcName,
        response: formatResponsePayload(remaining.content),
      },
    });
  }

  for (const remaining of unconsumedToolMsgs) {
    const funcName = remaining.name || "unknown_tool";
    functionResponseParts.push({
      functionResponse: {
        name: funcName,
        response: formatResponsePayload(remaining.content),
      },
    });
  }

  return functionResponseParts;
}
