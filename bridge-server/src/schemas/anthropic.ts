/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

export const AnthropicTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

export const AnthropicImageBlockSchema = z
  .object({
    type: z.literal("image"),
    source: z
      .object({
        type: z.string(),
        media_type: z.string(),
        data: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export const AnthropicToolUseBlockSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.union([z.record(z.unknown()), z.string(), z.any()]),
  })
  .passthrough();

export const AnthropicToolResultBlockSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.any()), z.record(z.unknown()), z.any()]).optional(),
    is_error: z.boolean().optional(),
  })
  .passthrough();

export const AnthropicThinkingBlockSchema = z
  .object({
    type: z.literal("thinking"),
    thinking: z.string(),
    signature: z.string().optional(),
  })
  .passthrough();

export const AnthropicRedactedThinkingBlockSchema = z
  .object({
    type: z.literal("redacted_thinking"),
    data: z.string().optional(),
  })
  .passthrough();

export const AnthropicContentBlockSchema = z.union([
  AnthropicTextBlockSchema,
  AnthropicImageBlockSchema,
  AnthropicToolUseBlockSchema,
  AnthropicToolResultBlockSchema,
  AnthropicThinkingBlockSchema,
  AnthropicRedactedThinkingBlockSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export const AnthropicMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
  })
  .passthrough();

export const AnthropicToolSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    input_schema: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const AnthropicThinkingConfigSchema = z
  .object({
    type: z.string().optional(),
    budget_tokens: z.number().optional(),
  })
  .passthrough();

export const AnthropicMessagesRequestSchema = z
  .object({
    model: z.string().min(1, "Model identifier is required"),
    messages: z.array(AnthropicMessageSchema).min(1, "Messages array must not be empty"),
    system: z.union([z.string(), z.array(z.any())]).optional(),
    max_tokens: z.number().int().positive().optional().default(4096),
    stream: z.boolean().optional().default(false),
    temperature: z.number().min(0).max(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().positive().optional(),
    tools: z.array(z.any()).optional(),
    thinking: AnthropicThinkingConfigSchema.optional(),
  })
  .passthrough();

export type AnthropicTextBlock = z.infer<typeof AnthropicTextBlockSchema>;
export type AnthropicImageBlock = z.infer<typeof AnthropicImageBlockSchema>;
export type AnthropicToolUseBlock = z.infer<typeof AnthropicToolUseBlockSchema>;
export type AnthropicToolResultBlock = z.infer<typeof AnthropicToolResultBlockSchema>;
export type AnthropicThinkingBlock = z.infer<typeof AnthropicThinkingBlockSchema>;
export type AnthropicRedactedThinkingBlock = z.infer<typeof AnthropicRedactedThinkingBlockSchema>;
export type AnthropicContentBlock = z.infer<typeof AnthropicContentBlockSchema>;
export type AnthropicMessage = z.infer<typeof AnthropicMessageSchema>;
export type AnthropicTool = z.infer<typeof AnthropicToolSchema>;
export type AnthropicThinkingConfig = z.infer<typeof AnthropicThinkingConfigSchema>;
export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;
