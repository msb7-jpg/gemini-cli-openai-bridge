/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelMetadata {
  id: string;
  object: "model";
  display_name: string;
  description: string;
  owned_by: string;
  context_length: number;
  max_output_tokens: number;
  supports_tools: boolean;
  supports_thinking: boolean;
}

/**
 * Helper to construct a ModelMetadata descriptor.
 *
 * @param id - The model identifier.
 * @param displayName - The human-readable model name.
 * @param description - Short summary of model capabilities.
 * @param supportsThinking - Whether the model supports reasoning tokens / thinking config.
 * @param contextLength - Maximum total context token limit.
 * @param maxOutputTokens - Maximum completion output token limit.
 * @returns Populated ModelMetadata record.
 */
function createModelCard(
  id: string,
  displayName: string,
  description: string,
  supportsThinking = true,
  contextLength = 1048576,
  maxOutputTokens = 65536,
): ModelMetadata {
  return {
    id,
    object: "model",
    display_name: displayName,
    description,
    owned_by: "google",
    context_length: contextLength,
    max_output_tokens: maxOutputTokens,
    supports_tools: true,
    supports_thinking: supportsThinking,
  };
}

export const SUPPORTED_MODELS: ModelMetadata[] = [
  createModelCard(
    "adaptive-gemini",
    "Adaptive Gemini",
    "Dynamic Autonomous Multi-Tier Router (Gemini 3.1 Flash Lite / 3.8 Flash / 3.1 Pro Preview)",
    true,
    1048576,
  ),
  createModelCard(
    "gemini-3.8-flash",
    "Gemini 3.8 Flash",
    "Google Gemini 3.8 Flash (Thinking Model, Ultra Fast & High Intelligence)",
  ),
  createModelCard(
    "gemini-3.5-flash",
    "Gemini 3.5 Flash",
    "Google Gemini 3.5 Flash (Balanced Multimodal & Reasoning)",
  ),
  createModelCard(
    "gemini-3.1-flash-lite",
    "Gemini 3.1 Flash Lite",
    "Google Gemini 3.1 Flash Lite (High Efficiency & Low Latency)",
    false,
  ),
  createModelCard(
    "gemini-2.5-pro",
    "Gemini 2.5 Pro",
    "Google Gemini 2.5 Pro (Deep Reasoning & Complex Coding)",
    true,
    2097152,
  ),
  createModelCard(
    "gemini-2.5-flash",
    "Gemini 2.5 Flash",
    "Google Gemini 2.5 Flash (Fast, Capable & Cost-effective)",
  ),
  createModelCard(
    "gemini-2.5-flash-lite",
    "Gemini 2.5 Flash Lite",
    "Google Gemini 2.5 Flash Lite (Lightweight & Rapid Execution)",
    false,
  ),
  createModelCard(
    "gemini-3-flash-preview",
    "Gemini 3 Flash Preview",
    "Google Gemini 3 Flash Preview Edition",
  ),
  createModelCard(
    "gemini-3-pro-preview",
    "Gemini 3 Pro Preview",
    "Google Gemini 3 Pro Preview Edition",
    true,
    2097152,
  ),
  createModelCard(
    "gemini-3.1-pro-preview",
    "Gemini 3.1 Pro Preview",
    "Google Gemini 3.1 Pro Preview Edition (Next-Gen Deep Reasoning)",
    true,
    2097152,
  ),
  createModelCard(
    "claude-3-7-sonnet",
    "Claude 3.7 Sonnet (Alias -> Gemini 3.8 Flash)",
    "Compatibility Alias mapped to Gemini 3.8 Flash",
  ),
  createModelCard(
    "claude-sonnet-4-6",
    "Claude Sonnet 4.6 (Alias -> Gemini 3.8 Flash)",
    "Compatibility Alias mapped to Gemini 3.8 Flash",
  ),
];

const ALIAS_MAP: Record<string, string> = {
  adaptive: "adaptive-gemini",
  "gemini-adaptive": "adaptive-gemini",
  "adaptive-gemini": "adaptive-gemini",
  flash: "gemini-2.5-flash",
  "gemini-flash": "gemini-2.5-flash",
  "flash-lite": "gemini-2.5-flash-lite",
  "gemini-flash-lite": "gemini-2.5-flash-lite",
  pro: "gemini-2.5-pro",
  "gemini-pro": "gemini-2.5-pro",
  "gemini-3.8": "gemini-3.8-flash",
  "gemini-3.5": "gemini-3.5-flash",
  "gemini-3.1": "gemini-3.1-flash-lite",
  "gemini-2.5": "gemini-2.5-flash",
  "claude-3-7-sonnet": "gemini-3.8-flash",
  "claude-sonnet-4-6": "gemini-3.8-flash",
  "claude-3-5-sonnet": "gemini-3.8-flash",
  "claude-3-5-haiku": "gemini-2.5-flash",
  "claude-3-opus": "gemini-2.5-pro",
};

/**
 * Resolves any requested model string to a clean, canonical Gemini API model ID.
 * Handles provider prefixes (e.g. "gemini-bridge/gemini-2.5-flash" -> "gemini-2.5-flash")
 * and alias mappings (e.g. "flash" -> "gemini-2.5-flash").
 *
 * @param requestedModel - The model identifier requested by the client.
 * @returns The resolved canonical Gemini model ID.
 */
export function resolveModelId(requestedModel?: string): string {
  if (!requestedModel || typeof requestedModel !== "string") {
    return process.env.GEMINI_MODEL || "gemini-3.8-flash";
  }

  let cleanModel = requestedModel.trim();
  if (cleanModel.includes("/")) {
    cleanModel = cleanModel.split("/").pop()!;
  }

  const lower = cleanModel.toLowerCase();
  if (ALIAS_MAP[lower]) {
    return ALIAS_MAP[lower];
  }

  if (lower.includes("haiku")) {
    return "gemini-2.5-flash";
  }
  if (lower.includes("opus")) {
    return "gemini-2.5-pro";
  }
  if (lower.includes("sonnet")) {
    return "gemini-3.8-flash";
  }

  return cleanModel;
}
