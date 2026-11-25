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

describe("sanitizeGeminiSchema - type inference and defaults", () => {
  it("infers string type when enum is present without type (VS Code Copilot configureAutomation)", () => {
    const input = {
      type: "object",
      properties: {
        permissionLevel: {
          description: "Permission level required for automation",
          enum: ["read", "write", "admin"],
        },
      },
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        permissionLevel: {
          type: "string",
          description: "Permission level required for automation",
          enum: ["read", "write", "admin"],
        },
      },
    });
  });

  it("defaults to string type when property only specifies description", () => {
    const input = {
      type: "object",
      properties: {
        targetBranch: {
          description: "Target branch to merge into",
        },
      },
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        targetBranch: {
          type: "string",
          description: "Target branch to merge into",
        },
      },
    });
  });

  it("infers object type when properties is present without type", () => {
    const input = {
      properties: {
        config: {
          properties: {
            retries: {
              type: "integer",
            },
          },
        },
      },
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            retries: {
              type: "integer",
            },
          },
        },
      },
    });
  });

  it("infers array type when items is present without type", () => {
    const input = {
      type: "object",
      properties: {
        tags: {
          description: "Tags list",
          items: {
            description: "Single tag",
          },
        },
      },
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        tags: {
          type: "array",
          description: "Tags list",
          items: {
            type: "string",
            description: "Single tag",
          },
        },
      },
    });
  });

  it("infers types from default values when type is omitted", () => {
    const input = {
      type: "object",
      properties: {
        enabled: {
          default: true,
        },
        count: {
          default: 5,
        },
        ratio: {
          default: 2.5,
        },
        label: {
          default: "default-label",
        },
      },
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          default: true,
        },
        count: {
          type: "integer",
          default: 5,
        },
        ratio: {
          type: "number",
          default: 2.5,
        },
        label: {
          type: "string",
          default: "default-label",
        },
      },
    });
  });

  it("infers number type from numeric bounds when type is omitted", () => {
    const input = {
      minimum: 0,
      maximum: 100,
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "number",
      minimum: 0,
      maximum: 100,
    });
  });

  it("simplifies oneOf with null branch to nullable type", () => {
    const input = {
      description: "Optional user ID",
      oneOf: [{ type: "string" }, { type: "null" }],
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "string",
      description: "Optional user ID",
      nullable: true,
    });
  });

  it("handles type: ['null'] by setting nullable: true and defaulting type to string", () => {
    const input = {
      type: ["null"],
      description: "Null only field",
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "string",
      description: "Null only field",
      nullable: true,
    });
  });

  it("normalizes uppercase type to lowercase", () => {
    const input = {
      type: "STRING",
      description: "Uppercase type test",
    };

    const sanitized = sanitizeGeminiSchema(input);
    expect(sanitized).toEqual({
      type: "string",
      description: "Uppercase type test",
    });
  });

  it("defaults to object for root parameters when isRootParameters option is set", () => {
    const input = {};
    const sanitized = sanitizeGeminiSchema(input, { isRootParameters: true });
    expect(sanitized).toEqual({
      type: "object",
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
