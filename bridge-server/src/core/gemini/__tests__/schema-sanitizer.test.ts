/**
 * @license
 * Copyright 2025-2026 Google LLC / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { sanitizeGeminiSchema } from "../schema-sanitizer.js";
import { parseFunctionNameFromId } from "../tool-fallback.synthesizer.js";

describe("sanitizeGeminiSchema", () => {
  it("removes unsupported JSON Schema keys like exclusiveMinimum and exclusiveMaximum", () => {
    const input = {
      type: "object",
      properties: {
        offset: {
          type: "integer",
          exclusiveMinimum: 0,
        },
        limit: {
          type: "integer",
          exclusiveMaximum: 100,
        },
      },
      required: ["offset"],
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#",
    };

    const sanitized = sanitizeGeminiSchema(input) as Record<string, unknown> & {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(sanitized).toEqual({
      type: "object",
      properties: {
        offset: {
          type: "integer",
          minimum: 1,
        },
        limit: {
          type: "integer",
          maximum: 99,
        },
      },
      required: ["offset"],
    });

    expect(sanitized).not.toHaveProperty("additionalProperties");
    expect(sanitized).not.toHaveProperty("$schema");
    expect(sanitized.properties.offset).not.toHaveProperty("exclusiveMinimum");
    expect(sanitized.properties.limit).not.toHaveProperty("exclusiveMaximum");
  });

  it("handles number float exclusiveMinimum", () => {
    const input = {
      type: "number",
      exclusiveMinimum: 5.5,
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "number",
      minimum: 5.5,
    });
  });

  it("converts const to enum", () => {
    const input = {
      type: "string",
      const: "git",
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "string",
      enum: ["git"],
    });
  });

  it("converts oneOf to anyOf", () => {
    const input = {
      oneOf: [{ type: "string" }, { type: "number" }],
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("converts type array with null to nullable", () => {
    const input = {
      type: ["string", "null"],
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "string",
      nullable: true,
    });
  });

  it("converts enum to array of strings", () => {
    const input = {
      type: "integer",
      enum: [1, 2, 3],
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "integer",
      enum: ["1", "2", "3"],
    });
  });

  it("strips unknown metadata keys like $id, $ref, $defs", () => {
    const input = {
      type: "object",
      $id: "https://example.com/schema",
      $defs: { someDef: {} },
      properties: {
        name: {
          type: "string",
          description: "A name",
          minLength: 1,
        },
      },
    };
    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "A name",
          minLength: 1,
        },
      },
    });
  });
});

describe("parseFunctionNameFromId", () => {
  it("parses name from standard bridge format call_{name}_{uuid}", () => {
    expect(parseFunctionNameFromId("call_read_file_4070a256-ff8e-4916-b8ef-bdae539958ee")).toBe(
      "read_file",
    );
    expect(parseFunctionNameFromId("call_search_12345")).toBe("search");
  });

  it("handles names with colons and special characters", () => {
    expect(parseFunctionNameFromId("call_default_api:bash_uuid123")).toBe("default_api:bash");
  });
});
