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

export interface SanitizeGeminiSchemaOptions {
  /**
   * Whether the schema is the root parameters object of a function declaration.
   * If true, defaults missing type to "object" instead of "string".
   */
  isRootParameters?: boolean;
}

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
  if (typeof newSchema.type === "string") {
    newSchema.type = newSchema.type.toLowerCase();
    if (newSchema.type === "null") {
      newSchema.nullable = true;
      newSchema.type = "string";
    }
  } else if (Array.isArray(newSchema.type)) {
    if (newSchema.type.includes("null")) {
      newSchema.nullable = true;
      const nonNullType = newSchema.type.find((typeItem: unknown) => typeItem !== "null");
      if (typeof nonNullType === "string") {
        newSchema.type = nonNullType.toLowerCase();
      } else {
        newSchema.type = "string";
      }
    } else if (newSchema.type.length > 0 && typeof newSchema.type[0] === "string") {
      newSchema.type = (newSchema.type[0] as string).toLowerCase();
    } else {
      delete newSchema.type;
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

function isNullTypeBranch(branch: unknown): boolean {
  if (branch === null || typeof branch !== "object") {
    return false;
  }
  const branchObj = branch as Record<string, unknown>;
  if (branchObj.type === "null") {
    return true;
  }
  if (Array.isArray(branchObj.type)) {
    const typeArray = branchObj.type as unknown[];
    return typeArray.length === 1 && typeArray[0] === "null";
  }
  return false;
}

function inferTypeFromValues(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  return undefined;
}

function inferSchemaType(
  newSchema: Record<string, unknown>,
  schemaObj: Record<string, unknown>,
  isRootParameters: boolean,
): string | undefined {
  if (typeof newSchema.type === "string" && newSchema.type.length > 0) {
    return newSchema.type;
  }

  if (isRootParameters) {
    return "object";
  }

  if (
    newSchema.properties !== undefined ||
    newSchema.required !== undefined ||
    newSchema.minProperties !== undefined ||
    newSchema.maxProperties !== undefined ||
    schemaObj.properties !== undefined ||
    schemaObj.required !== undefined
  ) {
    return "object";
  }

  if (
    newSchema.items !== undefined ||
    newSchema.minItems !== undefined ||
    newSchema.maxItems !== undefined ||
    schemaObj.items !== undefined
  ) {
    return "array";
  }

  if (
    newSchema.enum !== undefined ||
    newSchema.minLength !== undefined ||
    newSchema.maxLength !== undefined ||
    newSchema.pattern !== undefined ||
    newSchema.format !== undefined ||
    schemaObj.enum !== undefined ||
    schemaObj.const !== undefined
  ) {
    return "string";
  }

  if (
    newSchema.minimum !== undefined ||
    newSchema.maximum !== undefined ||
    schemaObj.minimum !== undefined ||
    schemaObj.maximum !== undefined ||
    schemaObj.exclusiveMinimum !== undefined ||
    schemaObj.exclusiveMaximum !== undefined ||
    schemaObj.multipleOf !== undefined
  ) {
    return "number";
  }

  const defaultType = inferTypeFromValues(newSchema.default ?? schemaObj.default);
  if (defaultType) {
    return defaultType;
  }

  const exampleType = inferTypeFromValues(newSchema.example ?? schemaObj.example);
  if (exampleType) {
    return exampleType;
  }

  if (Array.isArray(newSchema.anyOf) && newSchema.anyOf.length > 0) {
    const branchTypes = new Set<string>();
    for (const branch of newSchema.anyOf) {
      if (
        typeof branch === "object" &&
        branch !== null &&
        typeof (branch as Record<string, unknown>).type === "string"
      ) {
        branchTypes.add(((branch as Record<string, unknown>).type as string).toLowerCase());
      }
    }
    if (branchTypes.size === 1) {
      return Array.from(branchTypes)[0];
    }
    return undefined;
  }

  return "string";
}

/**
 * Recursively removes fields from a JSON schema that are not supported by the
 * Gemini API and maps common JSON Schema / OpenAPI 3.1 constructs to Gemini Schema.
 * Ensures all schema objects specify a valid `type` field.
 *
 * @param schema - The raw JSON schema object or value to sanitize.
 * @param options - Optional sanitization options such as root parameter handling.
 * @returns A sanitized schema object without unsupported keywords.
 */
export function sanitizeGeminiSchema(
  schema: unknown,
  options?: SanitizeGeminiSchemaOptions,
): unknown {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item: unknown) => sanitizeGeminiSchema(item));
  }

  const schemaObj = schema as Record<string, unknown>;
  const newSchema: Record<string, unknown> = {};

  const { minimum, maximum } = extractNumericBounds(schemaObj);
  const { mergedProperties, mergedRequired } = mergeAllOfBranches(schemaObj);

  let rawAnyOf = schemaObj.anyOf;
  if (!rawAnyOf && Array.isArray(schemaObj.oneOf)) {
    rawAnyOf = schemaObj.oneOf;
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
  if (enumValues !== undefined) {
    newSchema.enum = enumValues;
  }

  if (Array.isArray(rawAnyOf)) {
    const nonNullBranches: unknown[] = [];
    let hasNullBranch = false;
    for (const branch of rawAnyOf) {
      if (branch === null || isNullTypeBranch(branch)) {
        hasNullBranch = true;
      } else {
        nonNullBranches.push(branch);
      }
    }

    if (hasNullBranch) {
      newSchema.nullable = true;
    }

    if (
      hasNullBranch &&
      nonNullBranches.length === 1 &&
      typeof nonNullBranches[0] === "object" &&
      nonNullBranches[0] !== null
    ) {
      const singleBranch = nonNullBranches[0] as Record<string, unknown>;
      const sanitizedBranch = sanitizeGeminiSchema(singleBranch) as Record<string, unknown>;
      Object.assign(newSchema, sanitizedBranch);
      delete newSchema.anyOf;
    } else if (nonNullBranches.length > 0) {
      newSchema.anyOf = nonNullBranches;
    } else {
      delete newSchema.anyOf;
    }
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
      newSchema.items =
        newSchema.items.length > 0 ? sanitizeGeminiSchema(newSchema.items[0]) : { type: "string" };
    } else {
      newSchema.items = sanitizeGeminiSchema(newSchema.items);
    }
  }

  if (Array.isArray(newSchema.anyOf)) {
    newSchema.anyOf = newSchema.anyOf.map((branchItem: unknown) =>
      sanitizeGeminiSchema(branchItem),
    );
  }

  const inferredType = inferSchemaType(newSchema, schemaObj, Boolean(options?.isRootParameters));
  if (inferredType !== undefined) {
    newSchema.type = inferredType;
  }

  return newSchema;
}
