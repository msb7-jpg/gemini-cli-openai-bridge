/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

const OpenAITextContentPartSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
});

const OpenAIImageContentPartSchema = z.looseObject({
  type: z.literal("image_url"),
  image_url: z.looseObject({
    url: z.string(),
    detail: z.enum(["low", "high", "auto"]).optional(),
  }),
});

const OpenAIMessageContentPartSchema = z.union([
  OpenAITextContentPartSchema,
  OpenAIImageContentPartSchema,
  z.looseObject({ type: z.string() }),
]);

const OpenAIToolCallFunctionSchema = z.looseObject({
  name: z.string(),
  arguments: z.string(),
});

const OpenAIToolCallSchema = z.looseObject({
  id: z.string(),
  type: z.literal("function").default("function"),
  function: OpenAIToolCallFunctionSchema,
});

const OpenAIFunctionDefinitionSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const OpenAIToolSchema = z.looseObject({
  type: z.literal("function"),
  function: OpenAIFunctionDefinitionSchema,
});

export const OpenAIMessageSchema = z.looseObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z
    .union([z.string(), z.array(OpenAIMessageContentPartSchema), z.null()])
    .optional()
    .default(null),
  name: z.string().optional(),
  tool_calls: z.array(OpenAIToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

const OpenAIThinkingConfigSchema = z.looseObject({
  type: z.string().optional(),
  budget_tokens: z.number().optional(),
});

export const OpenAIChatCompletionRequestSchema = z.looseObject({
  model: z.string().min(1, "Model identifier is required"),
  messages: z.array(OpenAIMessageSchema).min(1, "Messages array must not be empty"),
  stream: z.boolean().optional().default(false),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  tools: z.array(OpenAIToolSchema).optional(),
  tool_choice: z.union([z.string(), z.record(z.string(), z.unknown()), z.unknown()]).optional(),
  response_format: z.unknown().optional(),
  reasoning_effort: z.string().optional(),
  thinking: OpenAIThinkingConfigSchema.optional(),
});

export type OpenAIToolCall = z.infer<typeof OpenAIToolCallSchema>;
export type OpenAITool = z.infer<typeof OpenAIToolSchema>;
export type OpenAIMessage = z.infer<typeof OpenAIMessageSchema>;
export type OpenAIChatCompletionRequest = z.infer<typeof OpenAIChatCompletionRequestSchema>;

export interface OpenAIChatCompletionMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIChatCompletionChoice {
  index: number;
  message: OpenAIChatCompletionMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call";
}

export interface OpenAIChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
