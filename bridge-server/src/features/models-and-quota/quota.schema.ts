/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

export const TokenUsageSchema = z.looseObject({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
});

const ModelUsageStatsSchema = z.looseObject({
  requests: z.number().int().nonnegative().default(0),
  tokens: TokenUsageSchema,
});

const QuotaWindowStatsSchema = z.looseObject({
  used: z.number().int().nonnegative().default(0),
  limit: z.number().int().nonnegative().default(0),
  remaining: z.number().int().nonnegative().default(0),
});

const RemoteModelQuotaSchema = z.looseObject({
  model: z.string(),
  percentage: z.number().optional(),
  resetTime: z.string().optional(),
});

export const QuotaSnapshotSchema = z.looseObject({
  status: z.enum(["healthy", "pro_quota_exceeded", "rate_limited"]),
  authType: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  requests: z.looseObject({
    total: z.number().int().nonnegative(),
    rpm: QuotaWindowStatsSchema.extend({
      windowSeconds: z.number().int().positive(),
    }),
    rpd: QuotaWindowStatsSchema.extend({
      windowHours: z.number().int().positive(),
    }),
  }),
  tokens: TokenUsageSchema,
  byModel: z.record(z.string(), ModelUsageStatsSchema),
  remoteModelQuotas: z.array(RemoteModelQuotaSchema).optional(),
  proQuotaExceeded: z.boolean(),
  genericQuotaExceeded: z.boolean(),
  retryAfterSeconds: z.number().nonnegative(),
  retryUntil: z.number().nullable(),
  lastQuotaError: z.string().nullable(),
  lastQuotaErrorTime: z.number().nullable(),
});

const ModelCardSchema = z.looseObject({
  id: z.string(),
  object: z.literal("model").default("model"),
  created: z.number().int().positive(),
  owned_by: z.string().default("google"),
  root: z.string().optional(),
  parent: z.string().nullable().optional(),
  permission: z.array(z.unknown()).optional().default([]),
});

export const ModelsListResponseSchema = z.looseObject({
  object: z.literal("list").default("list"),
  data: z.array(ModelCardSchema),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type ModelUsageStats = z.infer<typeof ModelUsageStatsSchema>;
export type QuotaWindowStats = z.infer<typeof QuotaWindowStatsSchema>;
