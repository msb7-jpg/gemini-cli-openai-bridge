/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { type CanonicalRequest } from "../../core/gemini/canonical-ir.types.js";
import { type QuotaSnapshot } from "../models-and-quota/quota-tracker.service.js";

/**
 * Execution tiers for adaptive model routing.
 */
export type AdaptiveTier = "fast" | "standard" | "heavy";

/**
 * Result of an adaptive model routing evaluation.
 */
export interface AdaptiveRouteDecision {
  tier: AdaptiveTier;
  targetModel: string;
  reason: string;
  latencyMs: number;
}

/**
 * Configuration options for the adaptive model router.
 */
export interface AdaptiveConfig {
  fastModel: string;
  standardModel: string;
  heavyModel: string;
  quotaFallbackEnabled: boolean;
}

/**
 * Evaluation context passed into routing rules.
 */
export interface RoutingContext {
  request: CanonicalRequest;
  quotaSnapshot?: QuotaSnapshot;
  hint?: string;
}

/**
 * Rule definition interface for evaluating routing context.
 */
export interface AdaptiveRule {
  name: string;
  evaluate: (
    context: RoutingContext,
    config: AdaptiveConfig,
  ) => Omit<AdaptiveRouteDecision, "latencyMs"> | undefined;
}
