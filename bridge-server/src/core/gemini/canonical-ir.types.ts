/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

export type CanonicalContentPart =
  | { type: "text"; text: string }
  | { type: "image_inline"; mimeType: string; data: string }
  | { type: "image_uri"; mimeType: string; fileUri: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolCallId?: string;
      name?: string;
      content: unknown;
    };

export interface CanonicalMessage {
  role: "system" | "user" | "assistant" | "tool";
  parts: CanonicalContentPart[];
}

export interface CanonicalToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  systemPrompt?: string;
  tools?: CanonicalToolDefinition[];
  toolChoice?: unknown;
}

export interface ReasoningData {
  reasoning: string;
}

export type CanonicalStreamEvent =
  | { type: "text"; data: string }
  | { type: "reasoning"; data: ReasoningData }
  | {
      type: "tool_code";
      data: {
        name: string;
        args: Record<string, unknown>;
        thoughtSignature?: string;
      };
    }
  | {
      type: "usage";
      data: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        totalTokenCount?: number;
      };
    };
