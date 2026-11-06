/**
 * @license
 * Copyright 2025-2026 Google LLC / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Content, type Part } from "@google/genai";
import { type CanonicalMessage } from "./canonical-ir.types.js";
import { resolveToolCallSignature, toolCallNameCache } from "./thought-signature.manager.js";
import {
  buildParityToolResponseParts,
  type IndexedToolCall,
  type RawToolResultItem,
} from "./tool-fallback.synthesizer.js";

export interface ConvertedGeminiMessages {
  contents: Content[];
  systemInstruction?: Content;
}

interface PartWithThoughtSignature {
  thoughtSignature?: string;
  thought_signature?: string;
}

function convertCanonicalAssistantToContent(msg: CanonicalMessage): Content {
  const parts: Part[] = [];

  for (const part of msg.parts) {
    if (part.type === "text" && part.text) {
      parts.push({ text: part.text });
    } else if (part.type === "tool_call") {
      const signature = resolveToolCallSignature(part.id, part.name);
      const functionCallPart: Part = {
        functionCall: {
          name: part.name,
          args: part.args,
        },
      };
      if (signature) {
        const partWithSignature = functionCallPart as Part & PartWithThoughtSignature;
        partWithSignature.thoughtSignature = signature;
        partWithSignature.thought_signature = signature;
      }
      parts.push(functionCallPart);
    }
  }

  if (parts.length === 0) {
    parts.push({ text: "" });
  }

  return { role: "model", parts };
}

function convertCanonicalUserToContent(msg: CanonicalMessage): Content {
  const parts: Part[] = [];

  for (const part of msg.parts) {
    if (part.type === "text") {
      parts.push({ text: part.text });
    } else if (part.type === "image_inline") {
      parts.push({
        inlineData: {
          mimeType: part.mimeType,
          data: part.data,
        },
      });
    } else if (part.type === "image_uri") {
      parts.push({
        fileData: {
          mimeType: part.mimeType,
          fileUri: part.fileUri,
        },
      });
    }
  }

  return {
    role: "user",
    parts: parts.length > 0 ? parts : [{ text: "" }],
  };
}

function extractPrecedingToolCalls(
  nonSystemMessages: CanonicalMessage[],
  toolStartIndex: number,
): IndexedToolCall[] {
  for (let lookupIndex = toolStartIndex - 1; lookupIndex >= 0; lookupIndex--) {
    if (nonSystemMessages[lookupIndex].role === "assistant") {
      const calls: IndexedToolCall[] = [];
      for (const part of nonSystemMessages[lookupIndex].parts) {
        if (part.type === "tool_call") {
          calls.push({ id: part.id, name: part.name });
        }
      }
      return calls;
    }
  }
  return [];
}

/**
 * Normalizes an array of protocol-agnostic `CanonicalMessage` turns into Gemini `Content[]`
 * and an optional `systemInstruction`. Handles consecutive turn merging, tool response
 * reordering, missing tool response synthesis, and thought signature re-injection.
 *
 * @param messages - Array of canonical messages.
 * @param options - Optional system prompt and internal prompt flags.
 * @returns Normalized Gemini `contents` and `systemInstruction`.
 */
export function normalizeCanonicalMessagesToGemini(
  messages: CanonicalMessage[],
  options?: {
    systemPrompt?: string;
    useInternalPrompt?: boolean;
  },
): ConvertedGeminiMessages {
  const systemParts: Part[] = [];
  const nonSystemMessages: CanonicalMessage[] = [];

  if (options?.systemPrompt && options.systemPrompt.trim()) {
    systemParts.push({ text: options.systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      for (const part of msg.parts) {
        if (part.type === "text" && part.text.trim()) {
          systemParts.push({ text: part.text });
        }
      }
    } else {
      nonSystemMessages.push(msg);
    }
  }

  let systemInstruction: Content | undefined = undefined;
  if (systemParts.length > 0 && !options?.useInternalPrompt) {
    systemInstruction = { role: "system", parts: systemParts };
  }

  const toolCallMap = new Map<string, IndexedToolCall>();
  for (const msg of nonSystemMessages) {
    if (msg.role === "assistant") {
      for (const part of msg.parts) {
        if (part.type === "tool_call" && part.id && part.name) {
          toolCallMap.set(part.id, { id: part.id, name: part.name });
          toolCallNameCache.set(part.id, part.name);
        }
      }
    }
  }

  const contents: Content[] = [];
  let i = 0;

  while (i < nonSystemMessages.length) {
    const msg = nonSystemMessages[i];

    if (msg.role === "tool") {
      const toolResults: RawToolResultItem[] = [];
      const toolStartIndex = i;
      while (i < nonSystemMessages.length && nonSystemMessages[i].role === "tool") {
        for (const part of nonSystemMessages[i].parts) {
          if (part.type === "tool_result") {
            toolResults.push({
              toolCallId: part.toolCallId,
              name: part.name,
              content: part.content,
            });
          }
        }
        i++;
      }

      const precedingToolCalls = extractPrecedingToolCalls(nonSystemMessages, toolStartIndex);
      const functionResponseParts = buildParityToolResponseParts(
        toolResults,
        precedingToolCalls,
        toolCallMap,
      );

      if (functionResponseParts.length > 0) {
        contents.push({
          role: "user",
          parts: functionResponseParts,
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const assistantContent = convertCanonicalAssistantToContent(msg);
      const prev = contents.length > 0 ? contents[contents.length - 1] : undefined;
      if (prev && prev.role === "model") {
        if (!prev.parts) prev.parts = [];
        if (assistantContent.parts) {
          prev.parts.push(...assistantContent.parts);
        }
      } else {
        contents.push(assistantContent);
      }
      i++;
      continue;
    }

    const userContent = convertCanonicalUserToContent(msg);
    const prev = contents.length > 0 ? contents[contents.length - 1] : undefined;
    const prevIsFunctionResponse = prev?.parts
      ? prev.parts.some((part) => "functionResponse" in part)
      : false;

    if (prev && prev.role === "user" && !prevIsFunctionResponse) {
      if (!prev.parts) prev.parts = [];
      if (userContent.parts) {
        prev.parts.push(...userContent.parts);
      }
    } else {
      contents.push(userContent);
    }
    i++;
  }

  if (contents.length > 0 && contents[0].role === "model") {
    contents.unshift({ role: "user", parts: [{ text: "Hello" }] });
  }

  return { contents, systemInstruction };
}
