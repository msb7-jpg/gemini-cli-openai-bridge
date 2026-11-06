/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

export const TokenUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().default(0),
    completionTokens: z.number().int().nonnegative().default(0),
    cachedTokens: z.number().int().nonnegative().default(0),
    totalTokens: z.number().int().nonnegative().default(0),
  })
  .passthrough();

export const ModelUsageStatsSchema = z
  .object({
    requests: z.number().int().nonnegative().default(0),
    tokens: TokenUsageSchema,
  })
  .passthrough();

export const QuotaWindowStatsSchema = z
  .object({
    used: z.number().int().nonnegative().default(0),
    limit: z.number().int().nonnegative().default(0),
    remaining: z.number().int().nonnegative().default(0),
  })
  .passthrough();

export const RemoteModelQuotaSchema = z
  .object({
    model: z.string(),
    percentage: z.number().optional(),
    resetTime: z.string().optional(),
  })
  .passthrough();

export const QuotaSnapshotSchema = z
  .object({
    status: z.enum(["healthy", "pro_quota_exceeded", "rate_limited"]),
    authType: z.string(),
    uptimeSeconds: z.number().nonnegative(),
    requests: z.object({
      total: z.number().int().nonnegative(),
      rpm: QuotaWindowStatsSchema.extend({
        windowSeconds: z.number().int().positive(),
      }),
      rpd: QuotaWindowStatsSchema.extend({
        windowHours: z.number().int().positive(),
      }),
    }),
    tokens: TokenUsageSchema,
    byModel: z.record(ModelUsageStatsSchema),
    remoteModelQuotas: z.array(RemoteModelQuotaSchema).optional(),
    proQuotaExceeded: z.boolean(),
    genericQuotaExceeded: z.boolean(),
    retryAfterSeconds: z.number().nonnegative(),
    retryUntil: z.number().nullable(),
    lastQuotaError: z.string().nullable(),
    lastQuotaErrorTime: z.number().nullable(),
  })
  .passthrough();

export const ModelCardSchema = z
  .object({
    id: z.string(),
    object: z.literal("model").default("model"),
    created: z.number().int().positive(),
    owned_by: z.string().default("google"),
    root: z.string().optional(),
    parent: z.string().nullable().optional(),
    permission: z.array(z.any()).optional().default([]),
  })
  .passthrough();

export const ModelsListResponseSchema = z
  .object({
    object: z.literal("list").default("list"),
    data: z.array(ModelCardSchema),
  })
  .passthrough();

export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type ModelUsageStats = z.infer<typeof ModelUsageStatsSchema>;
export type QuotaWindowStats = z.infer<typeof QuotaWindowStatsSchema>;
export type RemoteModelQuota = z.infer<typeof RemoteModelQuotaSchema>;
export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>;
export type ModelCard = z.infer<typeof ModelCardSchema>;
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;
