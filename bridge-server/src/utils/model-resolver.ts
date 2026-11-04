/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelMetadata {
  id: string;
  object: 'model';
  display_name: string;
  description: string;
  owned_by: string;
  context_length: number;
  max_output_tokens: number;
  supports_tools: boolean;
  supports_thinking: boolean;
}

export const SUPPORTED_MODELS: ModelMetadata[] = [
  {
    id: 'gemini-3.8-flash',
    object: 'model',
    display_name: 'Gemini 3.8 Flash',
    description: 'Google Gemini 3.8 Flash (Thinking Model, Ultra Fast & High Intelligence)',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
  {
    id: 'gemini-3.5-flash',
    object: 'model',
    display_name: 'Gemini 3.5 Flash',
    description: 'Google Gemini 3.5 Flash (Balanced Multimodal & Reasoning)',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
  {
    id: 'gemini-3.1-flash-lite',
    object: 'model',
    display_name: 'Gemini 3.1 Flash Lite',
    description: 'Google Gemini 3.1 Flash Lite (High Efficiency & Low Latency)',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: false,
  },
  {
    id: 'gemini-2.5-pro',
    object: 'model',
    display_name: 'Gemini 2.5 Pro',
    description: 'Google Gemini 2.5 Pro (Deep Reasoning & Complex Coding)',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
  {
    id: 'gemini-2.5-flash',
    object: 'model',
    display_name: 'Gemini 2.5 Flash',
    description: 'Google Gemini 2.5 Flash (Fast, Capable & Cost-effective)',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
  {
    id: 'gemini-2.5-flash-lite',
    object: 'model',
    display_name: 'Gemini 2.5 Flash Lite',
    description: 'Google Gemini 2.5 Flash Lite (Lightweight & Rapid Execution)',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: false,
  },
  {
    id: 'gemini-3-flash-preview',
    object: 'model',
    display_name: 'Gemini 3 Flash Preview',
    description: 'Google Gemini 3 Flash Preview Edition',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
  {
    id: 'gemini-3-pro-preview',
    object: 'model',
    display_name: 'Gemini 3 Pro Preview',
    description: 'Google Gemini 3 Pro Preview Edition',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
  {
    id: 'claude-3-7-sonnet',
    object: 'model',
    display_name: 'Claude 3.7 Sonnet (Alias -> Gemini 3.8 Flash)',
    description: 'Compatibility Alias mapped to Gemini 3.8 Flash',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
  {
    id: 'claude-sonnet-4-6',
    object: 'model',
    display_name: 'Claude Sonnet 4.6 (Alias -> Gemini 3.8 Flash)',
    description: 'Compatibility Alias mapped to Gemini 3.8 Flash',
    owned_by: 'google',
    context_length: 1048576,
    max_output_tokens: 65536,
    supports_tools: true,
    supports_thinking: true,
  },
];

const ALIAS_MAP: Record<string, string> = {
  // Family shortcuts
  flash: 'gemini-2.5-flash',
  'gemini-flash': 'gemini-2.5-flash',
  'flash-lite': 'gemini-2.5-flash-lite',
  'gemini-flash-lite': 'gemini-2.5-flash-lite',
  pro: 'gemini-2.5-pro',
  'gemini-pro': 'gemini-2.5-pro',

  // Version shortcuts
  'gemini-3.8': 'gemini-3.8-flash',
  'gemini-3.5': 'gemini-3.5-flash',
  'gemini-3.1': 'gemini-3.1-flash-lite',
  'gemini-2.5': 'gemini-2.5-flash',

  // Claude aliases
  'claude-3-7-sonnet': 'gemini-3.8-flash',
  'claude-sonnet-4-6': 'gemini-3.8-flash',
  'claude-3-5-sonnet': 'gemini-3.8-flash',
  'claude-3-5-haiku': 'gemini-2.5-flash',
  'claude-3-opus': 'gemini-2.5-pro',
};

/**
 * Resolves any requested model string to a clean, canonical Gemini API model ID.
 * Handles provider prefixes (e.g. "gemini-bridge/gemini-2.5-flash" -> "gemini-2.5-flash")
 * and alias mappings (e.g. "flash" -> "gemini-2.5-flash").
 */
export function resolveModelId(requestedModel?: string): string {
  if (!requestedModel || typeof requestedModel !== 'string') {
    return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  }

  let cleanModel = requestedModel.trim();

  // Strip provider prefixes (e.g. "gemini-bridge/gemini-3.8-flash" -> "gemini-3.8-flash")
  if (cleanModel.includes('/')) {
    cleanModel = cleanModel.split('/').pop()!;
  }

  const lower = cleanModel.toLowerCase();

  // Check alias map
  if (ALIAS_MAP[lower]) {
    return ALIAS_MAP[lower];
  }

  // Claude model prefix matching
  if (lower.includes('haiku')) {
    return 'gemini-2.5-flash';
  }
  if (lower.includes('opus')) {
    return 'gemini-2.5-pro';
  }
  if (lower.includes('sonnet')) {
    return 'gemini-3.8-flash';
  }

  // Return the cleaned model name directly
  return cleanModel;
}
