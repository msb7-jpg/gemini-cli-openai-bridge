/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { performance } from "node:perf_hooks";
import {
  type AdaptiveConfig,
  type AdaptiveRouteDecision,
  type AdaptiveRule,
  type AdaptiveTier,
  type RoutingContext,
} from "./adaptive.types.js";
import { DEFAULT_RULES } from "./adaptive-rules.js";

/**
 * Checks whether a given model string corresponds to the adaptive virtual model.
 *
 * @param modelName - The requested model identifier.
 * @returns True if the model identifier matches an adaptive model pattern.
 */
export function isAdaptiveModel(modelName?: string): boolean {
  if (!modelName || typeof modelName !== "string") {
    return false;
  }
  const clean = modelName.trim().toLowerCase();
  const baseName = clean.includes("/") ? clean.split("/").pop()! : clean;
  return (
    baseName === "adaptive-gemini" ||
    baseName === "gemini-adaptive" ||
    baseName === "adaptive" ||
    baseName.startsWith("adaptive-gemini:")
  );
}

/**
 * High-performance synchronous model routing engine.
 * Evaluates routing rules in sub-millisecond execution time (< 0.2ms) to eliminate latency overhead.
 */
export class AdaptiveRouter {
  private readonly config: AdaptiveConfig;
  private readonly rules: AdaptiveRule[];

  constructor(customConfig?: Partial<AdaptiveConfig>, customRules?: AdaptiveRule[]) {
    this.config = {
      fastModel:
        customConfig?.fastModel ||
        process.env.GEMINI_ADAPTIVE_FAST_MODEL ||
        "gemini-3.1-flash-lite",
      standardModel:
        customConfig?.standardModel ||
        process.env.GEMINI_ADAPTIVE_STANDARD_MODEL ||
        "gemini-3.8-flash",
      heavyModel:
        customConfig?.heavyModel ||
        process.env.GEMINI_ADAPTIVE_HEAVY_MODEL ||
        "gemini-3.1-pro-preview",
      quotaFallbackEnabled:
        customConfig?.quotaFallbackEnabled ?? process.env.GEMINI_QUOTA_FALLBACK !== "false",
    };
    this.rules = customRules || DEFAULT_RULES;
  }

  /**
   * Evaluates the routing context and returns a routing decision.
   * Execution is synchronous and typically takes less than 0.2 milliseconds.
   *
   * @param context - The context containing the canonical request and optional quota snapshot.
   * @returns An AdaptiveRouteDecision containing the chosen model, tier, reason, and latency.
   */
  public route(context: RoutingContext): AdaptiveRouteDecision {
    const startTime = performance.now();

    for (const rule of this.rules) {
      const decision = rule.evaluate(context, this.config);
      if (decision) {
        const latencyMs = Number((performance.now() - startTime).toFixed(3));
        return {
          ...decision,
          latencyMs,
        };
      }
    }

    const latencyMs = Number((performance.now() - startTime).toFixed(3));
    return {
      tier: "standard",
      targetModel: this.config.standardModel,
      reason: "default_fallback",
      latencyMs,
    };
  }

  /**
   * Resolves the next downgraded tier for quota or rate-limit fallbacks.
   *
   * @param currentTier - The current model tier that failed or was rate limited.
   * @returns The next tier and model identifier, or null if no further down-tiering is possible.
   */
  public getNextFallbackTier(
    currentTier: AdaptiveTier,
  ): { tier: AdaptiveTier; targetModel: string } | null {
    if (currentTier === "heavy") {
      return { tier: "standard", targetModel: this.config.standardModel };
    }
    if (currentTier === "standard") {
      return { tier: "fast", targetModel: this.config.fastModel };
    }
    return null;
  }

  /**
   * Gets the active configuration for the router.
   *
   * @returns The active AdaptiveConfig.
   */
  public getConfig(): AdaptiveConfig {
    return { ...this.config };
  }
}

export const globalAdaptiveRouter = new AdaptiveRouter();
