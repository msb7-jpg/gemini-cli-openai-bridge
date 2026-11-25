/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { resolveModelId, SUPPORTED_MODELS } from "../model-resolver.js";

describe("model-resolver", () => {
  it("should strip provider prefixes", () => {
    expect(resolveModelId("gemini-bridge/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(resolveModelId("openai/gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(resolveModelId("anthropic/claude-3-7-sonnet")).toBe("gemini-3.8-flash");
  });

  it("should resolve family aliases", () => {
    expect(resolveModelId("flash")).toBe("gemini-2.5-flash");
    expect(resolveModelId("gemini-flash")).toBe("gemini-2.5-flash");
    expect(resolveModelId("pro")).toBe("gemini-2.5-pro");
    expect(resolveModelId("gemini-pro")).toBe("gemini-2.5-pro");
    expect(resolveModelId("flash-lite")).toBe("gemini-2.5-flash-lite");
  });

  it("should resolve partial version aliases", () => {
    expect(resolveModelId("gemini-3.8")).toBe("gemini-3.8-flash");
    expect(resolveModelId("gemini-3.5")).toBe("gemini-3.5-flash");
    expect(resolveModelId("gemini-3.1")).toBe("gemini-3.1-flash-lite");
  });

  it("should resolve claude aliases", () => {
    expect(resolveModelId("claude-3-7-sonnet")).toBe("gemini-3.8-flash");
    expect(resolveModelId("claude-sonnet-4-6")).toBe("gemini-3.8-flash");
    expect(resolveModelId("claude-3-5-haiku")).toBe("gemini-2.5-flash");
    expect(resolveModelId("claude-3-opus")).toBe("gemini-2.5-pro");
  });

  it("should preserve exact canonical models", () => {
    expect(resolveModelId("gemini-3.8-flash")).toBe("gemini-3.8-flash");
    expect(resolveModelId("gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(resolveModelId("gemini-3.1-flash-lite")).toBe("gemini-3.1-flash-lite");
    expect(resolveModelId("gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(resolveModelId("gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(resolveModelId("gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
    expect(resolveModelId("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
    expect(resolveModelId("gemini-3-pro-preview")).toBe("gemini-3-pro-preview");
  });

  it("should provide complete list of supported models in SUPPORTED_MODELS", () => {
    const ids = SUPPORTED_MODELS.map((model) => model.id);
    expect(ids).toContain("gemini-3.8-flash");
    expect(ids).toContain("gemini-3.5-flash");
    expect(ids).toContain("gemini-3.1-flash-lite");
    expect(ids).toContain("gemini-2.5-pro");
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("gemini-2.5-flash-lite");
    expect(ids).toContain("gemini-3-flash-preview");
    expect(ids).toContain("gemini-3-pro-preview");
    expect(ids).toContain("gemini-3.1-pro-preview");
  });

  it("should configure 2M context for Pro models and 1M context for Flash models", () => {
    const proIds = ["gemini-2.5-pro", "gemini-3-pro-preview", "gemini-3.1-pro-preview"];
    const flashIds = [
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3-flash-preview",
    ];

    for (const modelId of proIds) {
      const model = SUPPORTED_MODELS.find((entry) => entry.id === modelId);
      expect(model).toBeDefined();
      expect(model?.context_length).toBe(2097152);
      expect(model?.max_output_tokens).toBe(65536);
    }

    for (const modelId of flashIds) {
      const model = SUPPORTED_MODELS.find((entry) => entry.id === modelId);
      expect(model).toBeDefined();
      expect(model?.context_length).toBe(1048576);
      expect(model?.max_output_tokens).toBe(65536);
    }
  });
});
