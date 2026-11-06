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
import { logger } from "../../shared/logger.js";
import { globalQuotaTracker } from "../models-and-quota/quota-tracker.service.js";
import {
  type OpenAIChatCompletion,
  type OpenAIChatCompletionChoice,
  type OpenAIChatCompletionMessage,
  type OpenAIChatCompletionRequest,
  type OpenAIMessage,
  type OpenAITool,
  type OpenAIToolCall,
} from "./openai.schema.js";

function mapOpenAIUserParts(msg: OpenAIMessage): CanonicalContentPart[] {
  if (typeof msg.content === "string") {
    return [{ type: "text", text: msg.content }];
  }
  if (!Array.isArray(msg.content)) {
    return [{ type: "text", text: "" }];
  }

  const parts: CanonicalContentPart[] = [];
  for (const rawPart of msg.content) {
    const part = rawPart as { type: string; text?: string; image_url?: { url: string } };
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text || "" });
    } else if (part.type === "image_url" && part.image_url?.url) {
      const imageUrl = part.image_url.url;
      if (imageUrl.startsWith("data:")) {
        const [mimePart, dataPart] = imageUrl.split(",");
        const mimeType = mimePart.split(":")[1]?.split(";")[0] || "image/jpeg";
        parts.push({ type: "image_inline", mimeType, data: dataPart || "" });
      } else {
        parts.push({ type: "image_uri", mimeType: "image/jpeg", fileUri: imageUrl });
      }
    }
  }
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

function mapOpenAIAssistantParts(msg: OpenAIMessage): CanonicalContentPart[] {
  const parts: CanonicalContentPart[] = [];
  if (msg.content && typeof msg.content === "string") {
    parts.push({ type: "text", text: msg.content });
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const toolCall of msg.tool_calls) {
      if (toolCall.type === "function" && toolCall.function) {
        let argsObject: Record<string, unknown> = {};
        try {
          argsObject = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch (e) {
          logger.warn(
            "Failed to parse tool call arguments",
            { arguments: toolCall.function.arguments },
            e,
          );
        }
        parts.push({
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.function.name,
          args: argsObject,
        });
      }
    }
  }
  return parts;
}

/**
 * Converts an array of OpenAI messages into `CanonicalMessage[]`.
 * @param messages - Incoming OpenAI messages.
 * @returns Array of canonical messages.
 */
export function mapOpenAIMessagesToCanonical(messages: OpenAIMessage[]): CanonicalMessage[] {
  const canonical: CanonicalMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const parts: CanonicalContentPart[] = [];
      if (typeof msg.content === "string" && msg.content.trim()) {
        parts.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const rawPart of msg.content) {
          const part = rawPart as { type: string; text?: string };
          if (part.type === "text" && part.text) {
            parts.push({ type: "text", text: part.text });
          }
        }
      }
      canonical.push({ role: "system", parts });
    } else if (msg.role === "tool") {
      canonical.push({
        role: "tool",
        parts: [
          {
            type: "tool_result",
            toolCallId: msg.tool_call_id,
            name: msg.name,
            content: msg.content,
          },
        ],
      });
    } else if (msg.role === "assistant") {
      canonical.push({
        role: "assistant",
        parts: mapOpenAIAssistantParts(msg),
      });
    } else {
      canonical.push({
        role: "user",
        parts: mapOpenAIUserParts(msg),
      });
    }
  }

  return canonical;
}

function mapOpenAIToolsToCanonical(tools?: OpenAITool[]): CanonicalToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  const defs = tools
    .filter((tool) => tool.type === "function" && tool.function)
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  return defs.length > 0 ? defs : undefined;
}

/**
 * Maps an incoming `OpenAIChatCompletionRequest` directly to a `CanonicalRequest`.
 * @param body - Validated OpenAI chat completion request body.
 * @param resolvedModel - Resolved canonical Gemini model ID.
 * @returns Protocol-agnostic `CanonicalRequest`.
 */
export function mapOpenAIRequestToCanonical(
  body: OpenAIChatCompletionRequest,
  resolvedModel: string,
): CanonicalRequest {
  return {
    model: resolvedModel,
    messages: mapOpenAIMessagesToCanonical(body.messages),
    tools: mapOpenAIToolsToCanonical(body.tools),
    toolChoice: body.tool_choice,
  };
}

/**
 * Collects a `CanonicalStreamEvent` generator into a single non-streaming `OpenAIChatCompletion` payload.
 * @param canonicalStream - Async generator yielding canonical events.
 * @param requestedModel - Model string requested by the client.
 * @param startTime - Epoch timestamp in milliseconds when the request started.
 * @returns Complete `OpenAIChatCompletion` response object.
 */
export async function collectOpenAIChatCompletion(
  canonicalStream: AsyncGenerator<CanonicalStreamEvent>,
  requestedModel: string,
  startTime: number,
): Promise<OpenAIChatCompletion> {
  let fullTextContent = "";
  const toolCalls: OpenAIToolCall[] = [];
  let finishReason: OpenAIChatCompletionChoice["finish_reason"] = "stop";
  let recordedUsage: OpenAIChatCompletion["usage"] | undefined = undefined;

  for await (const chunk of canonicalStream) {
    if (chunk.type === "text" && chunk.data) {
      fullTextContent += chunk.data;
    } else if (chunk.type === "tool_code" && chunk.data) {
      const toolCallId = `call_${chunk.data.name}_${randomUUID()}`;
      recordToolCallSignature(toolCallId, chunk.data.name, chunk.data.thoughtSignature);
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

      globalQuotaTracker.recordUsage(requestedModel, {
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

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(startTime / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: assistantMessage,
        finish_reason: finishReason,
      },
    ],
    usage: recordedUsage,
  };
}
