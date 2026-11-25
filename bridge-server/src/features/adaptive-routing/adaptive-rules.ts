/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CanonicalMessage,
  type CanonicalContentPart,
} from "../../core/gemini/canonical-ir.types.js";
import {
  type AdaptiveRule,
  type AdaptiveRouteDecision,
  type RoutingContext,
  type AdaptiveConfig,
} from "./adaptive.types.js";

const READ_ONLY_TOOL_PATTERNS = [
  "read",
  "view",
  "grep",
  "glob",
  "list",
  "search",
  "fetch",
  "find",
  "status",
  "inspect",
];

const HEAVY_KEYWORD_REGEX =
  /\b(?:architecture|architectural|refactor\s+(?:entire|all|whole|complete)|migration\s+plan|security\s+audit|vulnerability\s+assessment|deadlock|race\s+condition|root\s+cause|in-depth\s+analysis)\b/i;

const ERROR_INDICATOR_REGEX =
  /\b(?:error|exception|failed with code|traceback|syntaxerror|cannot find module|command failed|fatal:)\b/i;

const SHORT_PROMPT_REGEX =
  /^(?:yes|no|ok|okay|sure|continue|proceed|diff|show|status|next|go\s+ahead|run\s+tests|build|check)[.!?]?$/i;

/**
 * Extracts concatenated text content from canonical message parts.
 *
 * @param message - The canonical message to extract text from.
 * @returns Combined string of text content.
 */
function extractMessageText(message?: CanonicalMessage): string {
  if (!message || !message.parts) {
    return "";
  }
  const textSegments: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text" && part.text) {
      textSegments.push(part.text);
    }
  }
  return textSegments.join(" ").trim();
}

/**
 * Checks if a tool name represents a read-only or informational tool.
 *
 * @param toolName - The tool name identifier.
 * @returns True if tool represents read-only inspection.
 */
function isReadOnlyToolName(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  for (const pattern of READ_ONLY_TOOL_PATTERNS) {
    if (lower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Rule 1: Direct Hint or Prompt Tag Directive.
 * Checks for explicit routing hints in headers/context or prompt annotations (@fast, @heavy, @pro).
 */
const directHintRule: AdaptiveRule = {
  name: "direct-hint",
  evaluate(
    context: RoutingContext,
    config: AdaptiveConfig,
  ): Omit<AdaptiveRouteDecision, "latencyMs"> | undefined {
    const hintLower = context.hint?.toLowerCase().trim();
    if (hintLower) {
      if (hintLower === "fast" || hintLower === "flash-lite") {
        return { tier: "fast", targetModel: config.fastModel, reason: "hint_override_fast" };
      }
      if (hintLower === "heavy" || hintLower === "pro") {
        return { tier: "heavy", targetModel: config.heavyModel, reason: "hint_override_heavy" };
      }
      if (hintLower === "standard" || hintLower === "flash") {
        return {
          tier: "standard",
          targetModel: config.standardModel,
          reason: "hint_override_standard",
        };
      }
    }

    const lastMessage = context.request.messages[context.request.messages.length - 1];
    const text = extractMessageText(lastMessage);

    if (text.includes("@fast") || text.includes("@flash-lite")) {
      return { tier: "fast", targetModel: config.fastModel, reason: "prompt_tag_fast" };
    }
    if (text.includes("@heavy") || text.includes("@pro")) {
      return { tier: "heavy", targetModel: config.heavyModel, reason: "prompt_tag_heavy" };
    }
    if (text.includes("@standard") || text.includes("@flash")) {
      return { tier: "standard", targetModel: config.standardModel, reason: "prompt_tag_standard" };
    }

    return undefined;
  },
};

/**
 * Rule 2: Agent Tool Turn Inspection.
 * Evaluates whether the latest message is a tool result. Routes read-only tool results
 * to Flash Lite, and tool errors/failures to Standard/Heavy for analysis.
 */
const agentToolTurnRule: AdaptiveRule = {
  name: "agent-tool-turn",
  evaluate(
    context: RoutingContext,
    config: AdaptiveConfig,
  ): Omit<AdaptiveRouteDecision, "latencyMs"> | undefined {
    const messages = context.request.messages;
    if (messages.length === 0) {
      return undefined;
    }

    const lastMessage = messages[messages.length - 1];
    const isToolMessage = lastMessage.role === "tool";
    const hasToolResultParts = lastMessage.parts.some(
      (part: CanonicalContentPart) => part.type === "tool_result",
    );

    if (!isToolMessage && !hasToolResultParts) {
      return undefined;
    }

    let hasError = false;
    let hasReadOnlyTools = false;
    let hasModifyingTools = false;

    for (const part of lastMessage.parts) {
      if (part.type === "tool_result") {
        const contentStr =
          typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? "");
        if (ERROR_INDICATOR_REGEX.test(contentStr)) {
          hasError = true;
          break;
        }

        const toolName = part.name || "";
        if (isReadOnlyToolName(toolName)) {
          hasReadOnlyTools = true;
        } else {
          hasModifyingTools = true;
        }
      }
    }

    if (hasError) {
      return {
        tier: "standard",
        targetModel: config.standardModel,
        reason: "tool_error_recovery",
      };
    }

    if (hasReadOnlyTools && !hasModifyingTools) {
      return {
        tier: "fast",
        targetModel: config.fastModel,
        reason: "read_only_tool_result",
      };
    }

    return undefined;
  },
};

/**
 * Rule 3: Prompt Complexity Analysis.
 * Analyzes the user's latest text prompt for architectural keywords or trivial confirmations.
 */
const promptComplexityRule: AdaptiveRule = {
  name: "prompt-complexity",
  evaluate(
    context: RoutingContext,
    config: AdaptiveConfig,
  ): Omit<AdaptiveRouteDecision, "latencyMs"> | undefined {
    const messages = context.request.messages;
    if (messages.length === 0) {
      return undefined;
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") {
      return undefined;
    }

    const text = extractMessageText(lastMessage);
    if (!text) {
      return undefined;
    }

    if (HEAVY_KEYWORD_REGEX.test(text)) {
      if (context.quotaSnapshot?.proQuotaExceeded) {
        return {
          tier: "standard",
          targetModel: config.standardModel,
          reason: "heavy_task_downgraded_quota_cooldown",
        };
      }
      return {
        tier: "heavy",
        targetModel: config.heavyModel,
        reason: "complex_task_keyword",
      };
    }

    if (text.length < 100 && !text.includes("```")) {
      if (SHORT_PROMPT_REGEX.test(text) || text.length < 30) {
        return {
          tier: "fast",
          targetModel: config.fastModel,
          reason: "short_query",
        };
      }
    }

    return undefined;
  },
};

/**
 * Rule 4: Quota Cooldown Guard for Heavy requests.
 */
const quotaCooldownRule: AdaptiveRule = {
  name: "quota-cooldown-guard",
  evaluate(
    context: RoutingContext,
    config: AdaptiveConfig,
  ): Omit<AdaptiveRouteDecision, "latencyMs"> | undefined {
    if (context.quotaSnapshot?.proQuotaExceeded) {
      return {
        tier: "standard",
        targetModel: config.standardModel,
        reason: "pro_quota_cooldown_fallback",
      };
    }
    return undefined;
  },
};

/**
 * Default fallback rule: Standard Tier (Gemini 3.8 Flash).
 */
const defaultStandardRule: AdaptiveRule = {
  name: "default-standard",
  evaluate(
    _context: RoutingContext,
    config: AdaptiveConfig,
  ): Omit<AdaptiveRouteDecision, "latencyMs"> {
    return {
      tier: "standard",
      targetModel: config.standardModel,
      reason: "default_standard_tier",
    };
  },
};

export const DEFAULT_RULES: AdaptiveRule[] = [
  directHintRule,
  agentToolTurnRule,
  promptComplexityRule,
  quotaCooldownRule,
  defaultStandardRule,
];
