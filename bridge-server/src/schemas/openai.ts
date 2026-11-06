/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

export const OpenAITextContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

export const OpenAIImageContentPartSchema = z
  .object({
    type: z.literal("image_url"),
    image_url: z
      .object({
        url: z.string(),
        detail: z.enum(["low", "high", "auto"]).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const OpenAIMessageContentPartSchema = z.union([
  OpenAITextContentPartSchema,
  OpenAIImageContentPartSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export const OpenAIToolCallFunctionSchema = z
  .object({
    name: z.string(),
    arguments: z.string(),
  })
  .passthrough();

export const OpenAIToolCallSchema = z
  .object({
    id: z.string(),
    type: z.literal("function").default("function"),
    function: OpenAIToolCallFunctionSchema,
  })
  .passthrough();

export const OpenAIFunctionDefinitionSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const OpenAIToolSchema = z
  .object({
    type: z.literal("function"),
    function: OpenAIFunctionDefinitionSchema,
  })
  .passthrough();

export const OpenAIMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z
      .union([z.string(), z.array(OpenAIMessageContentPartSchema), z.null()])
      .optional()
      .default(null),
    name: z.string().optional(),
    tool_calls: z.array(OpenAIToolCallSchema).optional(),
    tool_call_id: z.string().optional(),
  })
  .passthrough();

export const OpenAIThinkingConfigSchema = z
  .object({
    type: z.string().optional(),
    budget_tokens: z.number().optional(),
  })
  .passthrough();

export const OpenAIChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1, "Model identifier is required"),
    messages: z.array(OpenAIMessageSchema).min(1, "Messages array must not be empty"),
    stream: z.boolean().optional().default(false),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    tools: z.array(OpenAIToolSchema).optional(),
    tool_choice: z.union([z.string(), z.record(z.unknown()), z.any()]).optional(),
    response_format: z.any().optional(),
    reasoning_effort: z.string().optional(),
    thinking: OpenAIThinkingConfigSchema.optional(),
  })
  .passthrough();

export type OpenAITextContentPart = z.infer<typeof OpenAITextContentPartSchema>;
export type OpenAIImageContentPart = z.infer<typeof OpenAIImageContentPartSchema>;
export type OpenAIMessageContentPart = z.infer<typeof OpenAIMessageContentPartSchema>;
export type OpenAIToolCallFunction = z.infer<typeof OpenAIToolCallFunctionSchema>;
export type OpenAIToolCall = z.infer<typeof OpenAIToolCallSchema>;
export type OpenAIFunctionDefinition = z.infer<typeof OpenAIFunctionDefinitionSchema>;
export type OpenAITool = z.infer<typeof OpenAIToolSchema>;
export type OpenAIMessage = z.infer<typeof OpenAIMessageSchema>;
export type OpenAIThinkingConfig = z.infer<typeof OpenAIThinkingConfigSchema>;
export type OpenAIChatCompletionRequest = z.infer<typeof OpenAIChatCompletionRequestSchema>;
