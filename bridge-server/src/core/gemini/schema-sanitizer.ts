/**
 * @license
 * Copyright 2025-2026 Google LLC / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

const ALLOWED_GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "propertyOrdering",
  "items",
  "maximum",
  "minimum",
  "maxLength",
  "minLength",
  "maxProperties",
  "minProperties",
  "pattern",
  "example",
  "anyOf",
  "default",
]);

function extractNumericBounds(schemaObj: Record<string, unknown>): {
  minimum: unknown;
  maximum: unknown;
} {
  let minimum = schemaObj.minimum;
  let maximum = schemaObj.maximum;

  if (typeof schemaObj.exclusiveMinimum === "number" && minimum === undefined) {
    minimum =
      schemaObj.type === "integer" ? schemaObj.exclusiveMinimum + 1 : schemaObj.exclusiveMinimum;
  }
  if (typeof schemaObj.exclusiveMaximum === "number" && maximum === undefined) {
    maximum =
      schemaObj.type === "integer" ? schemaObj.exclusiveMaximum - 1 : schemaObj.exclusiveMaximum;
  }

  return { minimum, maximum };
}

function mergeAllOfBranches(schemaObj: Record<string, unknown>): {
  mergedProperties: Record<string, unknown>;
  mergedRequired: unknown[] | undefined;
} {
  const existingProps =
    typeof schemaObj.properties === "object" && schemaObj.properties !== null
      ? (schemaObj.properties as Record<string, unknown>)
      : {};
  const mergedProperties: Record<string, unknown> = { ...existingProps };
  let mergedRequired = Array.isArray(schemaObj.required) ? [...schemaObj.required] : undefined;

  if (Array.isArray(schemaObj.allOf)) {
    for (const sub of schemaObj.allOf) {
      if (typeof sub === "object" && sub !== null) {
        const sanitizedSub = sanitizeGeminiSchema(sub) as Record<string, unknown>;
        if (typeof sanitizedSub.properties === "object" && sanitizedSub.properties !== null) {
          Object.assign(mergedProperties, sanitizedSub.properties);
        }
        if (Array.isArray(sanitizedSub.required)) {
          mergedRequired = [...(mergedRequired || []), ...sanitizedSub.required];
        }
      }
    }
  }

  return { mergedProperties, mergedRequired };
}

function normalizeTypeAndEnumFields(newSchema: Record<string, unknown>): void {
  if (Array.isArray(newSchema.type)) {
    if (newSchema.type.includes("null")) {
      newSchema.nullable = true;
      const nonNullType = newSchema.type.find((typeItem: unknown) => typeItem !== "null");
      if (nonNullType) {
        newSchema.type = nonNullType;
      } else {
        delete newSchema.type;
      }
    } else if (newSchema.type.length > 0) {
      newSchema.type = newSchema.type[0];
    }
  }

  if (Array.isArray(newSchema.enum)) {
    newSchema.enum = newSchema.enum.map((item: unknown) => String(item));
  }

  if (Array.isArray(newSchema.required)) {
    const filteredRequired = (newSchema.required as unknown[]).filter(
      (item: unknown) => typeof item === "string",
    );
    if (filteredRequired.length === 0) {
      delete newSchema.required;
    } else {
      newSchema.required = filteredRequired;
    }
  } else if (newSchema.required !== undefined) {
    delete newSchema.required;
  }
}

/**
 * Recursively removes fields from a JSON schema that are not supported by the
 * Gemini API and maps common JSON Schema / OpenAPI 3.1 constructs to Gemini Schema.
 *
 * @param schema - The raw JSON schema object or value to sanitize.
 * @returns A sanitized schema object without unsupported keywords.
 */
export function sanitizeGeminiSchema(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeGeminiSchema);
  }

  const schemaObj = schema as Record<string, unknown>;
  const newSchema: Record<string, unknown> = {};

  const { minimum, maximum } = extractNumericBounds(schemaObj);
  const { mergedProperties, mergedRequired } = mergeAllOfBranches(schemaObj);

  let anyOf = schemaObj.anyOf;
  if (!anyOf && Array.isArray(schemaObj.oneOf)) {
    anyOf = schemaObj.oneOf;
  }

  let enumValues = schemaObj.enum;
  if (!enumValues && schemaObj.const !== undefined) {
    enumValues = [schemaObj.const];
  }

  for (const key in schemaObj) {
    if (ALLOWED_GEMINI_SCHEMA_KEYS.has(key)) {
      newSchema[key] = schemaObj[key];
    }
  }

  if (Object.keys(mergedProperties).length > 0) {
    newSchema.properties = mergedProperties;
  }
  if (mergedRequired && mergedRequired.length > 0) {
    newSchema.required = mergedRequired;
  }
  if (minimum !== undefined) {
    newSchema.minimum = minimum;
  }
  if (maximum !== undefined) {
    newSchema.maximum = maximum;
  }
  if (anyOf !== undefined) {
    newSchema.anyOf = anyOf;
  }
  if (enumValues !== undefined) {
    newSchema.enum = enumValues;
  }

  normalizeTypeAndEnumFields(newSchema);

  if (newSchema.properties && typeof newSchema.properties === "object") {
    const propertiesRecord = newSchema.properties as Record<string, unknown>;
    const newProperties: Record<string, unknown> = {};
    for (const key in propertiesRecord) {
      newProperties[key] = sanitizeGeminiSchema(propertiesRecord[key]);
    }
    newSchema.properties = newProperties;
  }

  if (newSchema.items) {
    if (Array.isArray(newSchema.items)) {
      newSchema.items = newSchema.items.length > 0 ? sanitizeGeminiSchema(newSchema.items[0]) : {};
    } else {
      newSchema.items = sanitizeGeminiSchema(newSchema.items);
    }
  }

  if (Array.isArray(newSchema.anyOf)) {
    newSchema.anyOf = newSchema.anyOf.map(sanitizeGeminiSchema);
  }

  return newSchema;
}
