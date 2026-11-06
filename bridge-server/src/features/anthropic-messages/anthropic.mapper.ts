/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import {
  type CanonicalContentPart,
  type CanonicalMessage,
  type CanonicalRequest,
  type CanonicalStreamEvent,
  type CanonicalToolDefinition,
} from "../../core/gemini/canonical-ir.types.js";
import { recordToolCallSignature } from "../../core/gemini/thought-signature.manager.js";
import { resolveModelId } from "../models-and-quota/model-resolver.js";
import { globalQuotaTracker } from "../models-and-quota/quota-tracker.service.js";
import {
  type AnthropicMessage,
  type AnthropicMessageResponse,
  type AnthropicMessagesRequest,
} from "./anthropic.schema.js";

/**
 * Resolves an Anthropic or Gemini model identifier to a canonical Gemini model ID.
 * @param requestedModel - Model identifier requested by the client.
 * @returns Resolved canonical Gemini model ID.
 */
export function resolveAnthropicModel(requestedModel?: string): string {
  return resolveModelId(requestedModel);
}

function extractAnthropicSystemPrompt(
  system?: AnthropicMessagesRequest["system"],
): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") {
    return system.trim() ? system : undefined;
  }
  if (Array.isArray(system)) {
    const systemTexts = system
      .map((block) => {
        if (typeof block === "string") return block;
        if (typeof block === "object" && block !== null && "text" in block) {
          return String((block as { text?: unknown }).text || "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n");
    return systemTexts || undefined;
  }
  return undefined;
}

function serializeToolResultContent(rawContent: unknown): string {
  if (typeof rawContent === "string") {
    return rawContent;
  }
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .join("\n");
  }
  if (rawContent) {
    return JSON.stringify(rawContent);
  }
  return "";
}

function parseAnthropicToolUseInput(rawInput: unknown): Record<string, unknown> {
  if (typeof rawInput === "string") {
    try {
      const parsed = JSON.parse(rawInput);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (typeof rawInput === "object" && rawInput !== null && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  return {};
}

/**
 * Converts Anthropic messages and optional system prompt directly into `CanonicalMessage[]`
 * without converting through OpenAI intermediate message structures.
 *
 * @param anthropicMessages - Incoming Anthropic messages array.
 * @param system - Optional Anthropic system prompt string or block array.
 * @returns Array of `CanonicalMessage` turns.
 */
export function mapAnthropicMessagesToCanonical(
  anthropicMessages: AnthropicMessage[],
  system?: AnthropicMessagesRequest["system"],
): CanonicalMessage[] {
  const result: CanonicalMessage[] = [];
  const systemText = extractAnthropicSystemPrompt(system);

  if (systemText) {
    result.push({
      role: "system",
      parts: [{ type: "text", text: systemText }],
    });
  }

  for (const msg of anthropicMessages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({
          role: "user",
          parts: [{ type: "text", text: msg.content }],
        });
      } else if (Array.isArray(msg.content)) {
        const userParts: CanonicalContentPart[] = [];
        const toolMessages: CanonicalMessage[] = [];

        for (const rawBlock of msg.content) {
          const block = rawBlock as Record<string, unknown>;
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            userParts.push({ type: "text", text: block.text });
          } else if (block.type === "image" && typeof block.source === "object" && block.source) {
            const source = block.source as { media_type?: string; data?: string };
            if (source.data) {
              userParts.push({
                type: "image_inline",
                mimeType: source.media_type || "image/jpeg",
                data: source.data,
              });
            }
          } else if (block.type === "tool_result") {
            toolMessages.push({
              role: "tool",
              parts: [
                {
                  type: "tool_result",
                  toolCallId: String(block.tool_use_id || ""),
                  content: serializeToolResultContent(block.content),
                },
              ],
            });
          }
        }

        result.push(...toolMessages);
        if (userParts.length > 0) {
          result.push({
            role: "user",
            parts: userParts,
          });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        result.push({
          role: "assistant",
          parts: [{ type: "text", text: msg.content }],
        });
      } else if (Array.isArray(msg.content)) {
        const assistantParts: CanonicalContentPart[] = [];
        const textSegments: string[] = [];

        for (const rawBlock of msg.content) {
          const block = rawBlock as Record<string, unknown>;
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            textSegments.push(block.text);
          } else if (block.type === "tool_use") {
            assistantParts.push({
              type: "tool_call",
              id: String(block.id || ""),
              name: String(block.name || ""),
              args: parseAnthropicToolUseInput(block.input),
            });
          }
        }

        if (textSegments.length > 0) {
          assistantParts.unshift({ type: "text", text: textSegments.join("\n") });
        }

        result.push({
          role: "assistant",
          parts: assistantParts,
        });
      }
    }
  }

  return result;
}

/**
 * Converts Anthropic tool definitions directly into `CanonicalToolDefinition[]`.
 * @param tools - Raw tools array from an Anthropic request.
 * @returns Array of canonical tool definitions, or `undefined`.
 */
export function mapAnthropicToolsToCanonical(
  tools?: AnthropicMessagesRequest["tools"],
): CanonicalToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const mapped: CanonicalToolDefinition[] = [];
  for (const rawTool of tools) {
    if (typeof rawTool === "object" && rawTool !== null && "name" in rawTool) {
      const tool = rawTool as {
        name: string;
        description?: string;
        input_schema?: Record<string, unknown>;
      };
      mapped.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      });
    }
  }

  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Maps an incoming `AnthropicMessagesRequest` directly to a `CanonicalRequest`.
 * @param body - Validated Anthropic request payload.
 * @param targetModel - Resolved canonical Gemini model ID.
 * @returns Protocol-agnostic `CanonicalRequest`.
 */
export function mapAnthropicRequestToCanonical(
  body: AnthropicMessagesRequest,
  targetModel: string,
): CanonicalRequest {
  return {
    model: targetModel,
    messages: mapAnthropicMessagesToCanonical(body.messages || [], body.system),
    tools: mapAnthropicToolsToCanonical(body.tools),
  };
}

/**
 * Collects a `CanonicalStreamEvent` generator into a single non-streaming `AnthropicMessageResponse`.
 * @param canonicalStream - Async generator yielding canonical stream events.
 * @param responseModel - Model identifier to report in the response.
 * @returns Complete `AnthropicMessageResponse` payload.
 */
export async function collectAnthropicMessageResponse(
  canonicalStream: AsyncGenerator<CanonicalStreamEvent>,
  responseModel: string,
): Promise<AnthropicMessageResponse> {
  let textContent = "";
  const toolUseBlocks: AnthropicMessageResponse["content"] = [];
  let promptTokens = 15;
  let completionTokens = 1;

  for await (const chunk of canonicalStream) {
    if (chunk.type === "text" && chunk.data) {
      textContent += chunk.data;
    } else if (chunk.type === "tool_code") {
      const { name, args, thoughtSignature } = chunk.data;
      const toolCallId = `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
      recordToolCallSignature(toolCallId, name, thoughtSignature);
      toolUseBlocks.push({
        type: "tool_use",
        id: toolCallId,
        name,
        input: args ?? {},
      });
    } else if (chunk.type === "usage" && chunk.data) {
      promptTokens = chunk.data.promptTokenCount || promptTokens;
      completionTokens = chunk.data.candidatesTokenCount || completionTokens;
      const cached = chunk.data.cachedContentTokenCount || 0;
      const total = chunk.data.totalTokenCount || promptTokens + completionTokens;

      globalQuotaTracker.recordUsage(responseModel, {
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

  return {
    id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    type: "message",
    role: "assistant",
    model: responseModel,
    content: contentBlocks,
    stop_reason: toolUseBlocks.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: promptTokens,
      output_tokens: Math.max(completionTokens, Math.ceil(textContent.length / 4), 1),
    },
  };
}

/**
 * Estimates input token count for Anthropic `/v1/messages/count_tokens`.
 * @param body - Incoming Anthropic messages payload.
 * @returns Approximate input token count.
 */
export function estimateAnthropicInputTokens(body?: Partial<AnthropicMessagesRequest>): number {
  let approxChars = 0;

  if (body?.system) {
    approxChars += typeof body.system === "string" ? body.system.length : 100;
  }
  for (const msg of body?.messages || []) {
    if (typeof msg.content === "string") {
      approxChars += msg.content.length;
    }
  }

  return Math.max(Math.ceil(approxChars / 4), 10);
}
