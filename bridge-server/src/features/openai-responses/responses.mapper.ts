/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CanonicalContentPart,
  type CanonicalMessage,
  type CanonicalRequest,
  type CanonicalToolDefinition,
} from "../../core/gemini/canonical-ir.types.js";
import { type ResponsesApiRequestBody } from "./responses.schema.js";

function mapResponsesToolsToCanonical(tools?: unknown[]): CanonicalToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const mapped: CanonicalToolDefinition[] = [];
  for (const rawTool of tools) {
    if (typeof rawTool !== "object" || rawTool === null) continue;
    const toolObj = rawTool as {
      type?: string;
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
      function?: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
      };
    };

    if (toolObj.type === "function" && toolObj.function?.name) {
      mapped.push({
        name: toolObj.function.name,
        description: toolObj.function.description,
        parameters: toolObj.function.parameters,
      });
    } else if (typeof toolObj.name === "string") {
      mapped.push({
        name: toolObj.name,
        description: toolObj.description,
        parameters: toolObj.parameters,
      });
    }
  }

  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Maps an incoming OpenAI Responses API (`/v1/responses`) payload directly to a `CanonicalRequest`.
 * @param body - Incoming Responses API request body.
 * @param resolvedModel - Resolved canonical Gemini model ID.
 * @returns Protocol-agnostic `CanonicalRequest`.
 */
export function mapResponsesRequestToCanonical(
  body: ResponsesApiRequestBody,
  resolvedModel: string,
): CanonicalRequest {
  const messages: CanonicalMessage[] = [];

  for (const item of body.input || []) {
    if (item.type === "message") {
      let textContent = "";
      const parts: CanonicalContentPart[] = [];

      for (const part of item.content || []) {
        if (part.type === "input_text" || part.type === "text") {
          textContent += part.text || "";
        } else if (part.type === "input_image" && part.image_url?.url) {
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

      if (textContent) {
        parts.unshift({ type: "text", text: textContent });
      }
      if (parts.length === 0) {
        parts.push({ type: "text", text: "" });
      }

      let role = item.role;
      if (role === "developer") role = "system";

      messages.push({
        role: (role ?? "user") as "assistant" | "system" | "tool" | "user",
        parts,
      });
    }
  }

  return {
    model: resolvedModel,
    messages,
    tools: mapResponsesToolsToCanonical(body.tools),
    toolChoice: body.tool_choice,
  };
}
