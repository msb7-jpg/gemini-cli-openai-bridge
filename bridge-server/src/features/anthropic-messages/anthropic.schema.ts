/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

const AnthropicTextBlockSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
});

const AnthropicImageBlockSchema = z.looseObject({
  type: z.literal("image"),
  source: z.looseObject({
    type: z.string(),
    media_type: z.string(),
    data: z.string(),
  }),
});

const AnthropicToolUseBlockSchema = z.looseObject({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.union([z.record(z.string(), z.unknown()), z.string(), z.unknown()]),
});

const AnthropicToolResultBlockSchema = z.looseObject({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z
    .union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown()), z.unknown()])
    .optional(),
  is_error: z.boolean().optional(),
});

const AnthropicThinkingBlockSchema = z.looseObject({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(),
});

const AnthropicRedactedThinkingBlockSchema = z.looseObject({
  type: z.literal("redacted_thinking"),
  data: z.string().optional(),
});

const AnthropicKnownContentBlockSchema = z.discriminatedUnion("type", [
  AnthropicTextBlockSchema,
  AnthropicImageBlockSchema,
  AnthropicToolUseBlockSchema,
  AnthropicToolResultBlockSchema,
  AnthropicThinkingBlockSchema,
  AnthropicRedactedThinkingBlockSchema,
]);

const AnthropicContentBlockSchema = z.union([
  AnthropicKnownContentBlockSchema,
  z.looseObject({ type: z.string() }),
]);

const AnthropicMessageSchema = z.looseObject({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
});

const AnthropicThinkingConfigSchema = z.looseObject({
  type: z.string().optional(),
  budget_tokens: z.number().optional(),
});

export const AnthropicMessagesRequestSchema = z.looseObject({
  model: z.string().min(1, "Model identifier is required"),
  messages: z.array(AnthropicMessageSchema).min(1, "Messages array must not be empty"),
  system: z.union([z.string(), z.array(z.unknown())]).optional(),
  max_tokens: z.number().int().positive().optional().default(4096),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  tools: z.array(z.unknown()).optional(),
  thinking: AnthropicThinkingConfigSchema.optional(),
});

export type AnthropicMessage = z.infer<typeof AnthropicMessageSchema>;
export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
