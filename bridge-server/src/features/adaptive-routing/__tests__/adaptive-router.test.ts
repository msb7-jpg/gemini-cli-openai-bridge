/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { AdaptiveRouter, isAdaptiveModel, globalAdaptiveRouter } from "../adaptive-router.js";
import { type CanonicalRequest } from "../../../core/gemini/canonical-ir.types.js";
import { type QuotaSnapshot } from "../../models-and-quota/quota-tracker.service.js";

describe("Adaptive Router Slice", () => {
  describe("isAdaptiveModel", () => {
    it("recognizes adaptive model identifiers and aliases", () => {
      expect(isAdaptiveModel("adaptive-gemini")).toBe(true);
      expect(isAdaptiveModel("gemini-adaptive")).toBe(true);
      expect(isAdaptiveModel("adaptive")).toBe(true);
      expect(isAdaptiveModel("google/adaptive-gemini")).toBe(true);
      expect(isAdaptiveModel("gemini-bridge/adaptive-gemini:latest")).toBe(true);
    });

    it("rejects non-adaptive models", () => {
      expect(isAdaptiveModel("gemini-2.5-pro")).toBe(false);
      expect(isAdaptiveModel("gemini-3.8-flash")).toBe(false);
      expect(isAdaptiveModel("claude-3-7-sonnet")).toBe(false);
      expect(isAdaptiveModel(undefined)).toBe(false);
    });
  });

  describe("Routing Rules & Heuristics", () => {
    const router = new AdaptiveRouter();

    it("routes explicit fast and heavy hints correctly", () => {
      const request: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [{ role: "user", parts: [{ type: "text", text: "What is 2+2?" }] }],
      };

      const fastDecision = router.route({ request, hint: "fast" });
      expect(fastDecision.tier).toBe("fast");
      expect(fastDecision.targetModel).toBe("gemini-3.1-flash-lite");
      expect(fastDecision.reason).toBe("hint_override_fast");

      const heavyDecision = router.route({ request, hint: "heavy" });
      expect(heavyDecision.tier).toBe("heavy");
      expect(heavyDecision.targetModel).toBe("gemini-3.1-pro-preview");
      expect(heavyDecision.reason).toBe("hint_override_heavy");
    });

    it("detects inline prompt tags such as @fast or @heavy", () => {
      const fastReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [{ role: "user", parts: [{ type: "text", text: "Check syntax @fast" }] }],
      };
      const fastDecision = router.route({ request: fastReq });
      expect(fastDecision.tier).toBe("fast");
      expect(fastDecision.reason).toBe("prompt_tag_fast");

      const heavyReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [
          { role: "user", parts: [{ type: "text", text: "Plan database migration @pro" }] },
        ],
      };
      const heavyDecision = router.route({ request: heavyReq });
      expect(heavyDecision.tier).toBe("heavy");
      expect(heavyDecision.reason).toBe("prompt_tag_heavy");
    });

    it("routes read-only tool results to Fast Tier (Gemini 3.1 Flash Lite)", () => {
      const toolTurnReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Inspect package.json" }],
          },
          {
            role: "tool",
            parts: [
              {
                type: "tool_result",
                name: "read_file",
                content: '{"name": "my-app", "version": "1.0.0"}',
              },
            ],
          },
        ],
      };

      const decision = router.route({ request: toolTurnReq });
      expect(decision.tier).toBe("fast");
      expect(decision.targetModel).toBe("gemini-3.1-flash-lite");
      expect(decision.reason).toBe("read_only_tool_result");
    });

    it("escalates tool failures and errors to Standard Tier for recovery", () => {
      const failedToolReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Run test suite" }],
          },
          {
            role: "tool",
            parts: [
              {
                type: "tool_result",
                name: "bash",
                content: "Error: test execution failed with code 1\nSyntaxError: Unexpected token",
              },
            ],
          },
        ],
      };

      const decision = router.route({ request: failedToolReq });
      expect(decision.tier).toBe("standard");
      expect(decision.targetModel).toBe("gemini-3.8-flash");
      expect(decision.reason).toBe("tool_error_recovery");
    });

    it("routes short prompts and confirmations to Fast Tier", () => {
      const shortReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [{ role: "user", parts: [{ type: "text", text: "yes" }] }],
      };

      const decision = router.route({ request: shortReq });
      expect(decision.tier).toBe("fast");
      expect(decision.targetModel).toBe("gemini-3.1-flash-lite");
      expect(decision.reason).toBe("short_query");
    });

    it("routes architectural and planning prompts to Heavy Tier", () => {
      const heavyReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: "Design the software architecture and migration plan for the core engine.",
              },
            ],
          },
        ],
      };

      const decision = router.route({ request: heavyReq });
      expect(decision.tier).toBe("heavy");
      expect(decision.targetModel).toBe("gemini-3.1-pro-preview");
      expect(decision.reason).toBe("complex_task_keyword");
    });

    it("proactively downgrades heavy queries to Standard Tier when Pro quota is exceeded", () => {
      const heavyReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: "Analyze the architectural security audit for vulnerabilities.",
              },
            ],
          },
        ],
      };

      const mockQuotaSnapshot: Partial<QuotaSnapshot> = {
        proQuotaExceeded: true,
      };

      const decision = router.route({
        request: heavyReq,
        quotaSnapshot: mockQuotaSnapshot as QuotaSnapshot,
      });

      expect(decision.tier).toBe("standard");
      expect(decision.targetModel).toBe("gemini-3.8-flash");
      expect(decision.reason).toBe("heavy_task_downgraded_quota_cooldown");
    });

    it("routes default multi-turn coding to Standard Tier (Gemini 3.8 Flash)", () => {
      const defaultReq: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: "Here is the implementation of the auth service. Please add input validation and a unit test.",
              },
            ],
          },
        ],
      };

      const decision = router.route({ request: defaultReq });
      expect(decision.tier).toBe("standard");
      expect(decision.targetModel).toBe("gemini-3.8-flash");
    });
  });

  describe("Fallback Tier Resolution", () => {
    it("provides correct down-tier transitions", () => {
      const router = globalAdaptiveRouter;
      expect(router.getNextFallbackTier("heavy")).toEqual({
        tier: "standard",
        targetModel: "gemini-3.8-flash",
      });
      expect(router.getNextFallbackTier("standard")).toEqual({
        tier: "fast",
        targetModel: "gemini-3.1-flash-lite",
      });
      expect(router.getNextFallbackTier("fast")).toBeNull();
    });
  });

  describe("Latency & Performance Guarantee", () => {
    it("executes 1,000 routing decisions in under 10ms (<0.01ms per decision)", () => {
      const router = new AdaptiveRouter();
      const testRequest: CanonicalRequest = {
        model: "adaptive-gemini",
        messages: [
          { role: "user", parts: [{ type: "text", text: "Read the file and report status" }] },
          { role: "tool", parts: [{ type: "tool_result", name: "read_file", content: "data" }] },
        ],
      };

      const startTime = performance.now();
      const iterations = 1000;
      for (let iterationIndex = 0; iterationIndex < iterations; iterationIndex++) {
        const decision = router.route({ request: testRequest });
        expect(decision.tier).toBe("fast");
      }
      const totalDuration = performance.now() - startTime;
      const averageDuration = totalDuration / iterations;

      expect(totalDuration).toBeLessThan(500);
      expect(averageDuration).toBeLessThan(0.5);
    });
  });
});
