/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { remoteQuotaClient, type RemoteModelQuota } from "./remote-quota.client.js";
import type { TokenUsage, ModelUsageStats, QuotaWindowStats } from "./quota.schema.js";

export type { TokenUsage, ModelUsageStats, QuotaWindowStats };

export interface QuotaSnapshot {
  status: "healthy" | "pro_quota_exceeded" | "rate_limited";
  authType: string;
  uptimeSeconds: number;
  requests: {
    total: number;
    rpm: QuotaWindowStats & { windowSeconds: number };
    rpd: QuotaWindowStats & { windowHours: number };
  };
  tokens: TokenUsage;
  byModel: Record<string, ModelUsageStats>;
  remoteModelQuotas?: RemoteModelQuota[];
  proQuotaExceeded: boolean;
  genericQuotaExceeded: boolean;
  retryAfterSeconds: number;
  retryUntil: number | null;
  lastQuotaError: string | null;
  lastQuotaErrorTime: number | null;
}

/**
 * In-memory token and request rate tracker for the bridge server.
 */
export class QuotaTracker {
  private startTime: number = Date.now();
  private authType: string = "unknown";
  private requestTimestamps: number[] = [];
  private totalRequests: number = 0;

  private tokens: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
  };

  private modelStats: Map<string, ModelUsageStats> = new Map();

  private proQuotaExceeded: boolean = false;
  private genericQuotaExceeded: boolean = false;
  private lastQuotaError: string | null = null;
  private lastQuotaErrorTime: number | null = null;
  private retryUntil: number | null = null;

  private rpmLimit: number = 60;
  private rpdLimit: number = 1000;

  constructor(options?: { authType?: string; rpmLimit?: number; rpdLimit?: number }) {
    this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || "60", 10);
    this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || "1000", 10);

    if (options?.authType) {
      this.setAuthType(options.authType);
    }

    if (options?.rpmLimit) this.rpmLimit = options.rpmLimit;
    if (options?.rpdLimit) this.rpdLimit = options.rpdLimit;
  }

  /**
   * Configures default RPM/RPD limits based on the active authentication method.
   * @param authType - Active authentication type string.
   */
  public setAuthType(authType: string): void {
    this.authType = authType;
    const lower = authType.toLowerCase();

    if (lower.includes("oauth") || lower.includes("code_assist") || lower.includes("cloud")) {
      this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || "60", 10);
      this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || "1000", 10);
    } else if (lower.includes("api_key") || lower.includes("gemini")) {
      this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || "15", 10);
      this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || "1500", 10);
    } else {
      this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || "60", 10);
      this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || "1000", 10);
    }
  }

  /**
   * Records the start of an incoming bridge request for RPM/RPD sliding windows.
   */
  public recordRequestStart(): void {
    const now = Date.now();
    this.totalRequests++;
    this.requestTimestamps.push(now);
    this.cleanTimestamps(now);
  }

  /**
   * Accumulates prompt, completion, cached, and total token usage globally and per model.
   * @param model - Model identifier.
   * @param usage - Token count delta from a completion chunk.
   */
  public recordUsage(
    model: string,
    usage: {
      promptTokens?: number;
      completionTokens?: number;
      cachedTokens?: number;
      totalTokens?: number;
    },
  ): void {
    const prompt = usage.promptTokens || 0;
    const completion = usage.completionTokens || 0;
    const cached = usage.cachedTokens || 0;
    const total = usage.totalTokens || prompt + completion;

    this.tokens.promptTokens += prompt;
    this.tokens.completionTokens += completion;
    this.tokens.cachedTokens += cached;
    this.tokens.totalTokens += total;

    const currentModel = this.modelStats.get(model) || {
      requests: 0,
      tokens: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 },
    };

    currentModel.requests++;
    currentModel.tokens.promptTokens += prompt;
    currentModel.tokens.completionTokens += completion;
    currentModel.tokens.cachedTokens += cached;
    currentModel.tokens.totalTokens += total;

    this.modelStats.set(model, currentModel);
  }

  /**
   * Inspects an upstream error to detect rate-limit or Pro quota exhaustion and extracts retry-after cooldowns.
   * @param error - Caught error object or message.
   */
  public recordQuotaError(error: unknown): void {
    const errorStr = this.extractErrorMessage(error);
    const now = Date.now();

    this.lastQuotaError = errorStr;
    this.lastQuotaErrorTime = now;

    const isPro =
      errorStr.includes("Quota exceeded for quota metric 'Gemini") &&
      errorStr.includes("Pro Requests'");
    const isGeneric =
      errorStr.includes("Quota exceeded for quota metric") ||
      errorStr.toLowerCase().includes("resource_exhausted") ||
      errorStr.includes("429");

    if (isPro) {
      this.proQuotaExceeded = true;
    }
    if (isGeneric) {
      this.genericQuotaExceeded = true;
    }

    const retryDelaySec = this.extractRetryAfterSeconds(error, errorStr);
    if (retryDelaySec > 0) {
      this.retryUntil = now + retryDelaySec * 1000;
    } else {
      this.retryUntil = now + 60_000;
    }
  }

  /**
   * Computes a synchronous snapshot of local quota and token metrics.
   * @returns Current `QuotaSnapshot`.
   */
  public getSnapshot(): QuotaSnapshot {
    const now = Date.now();
    this.cleanTimestamps(now);

    if (this.retryUntil && now >= this.retryUntil) {
      this.proQuotaExceeded = false;
      this.genericQuotaExceeded = false;
      this.retryUntil = null;
    }

    const rpmUsed = this.requestTimestamps.filter((timestamp) => timestamp >= now - 60_000).length;
    const rpdUsed = this.requestTimestamps.filter(
      (timestamp) => timestamp >= now - 86_400_000,
    ).length;

    const retryAfterSeconds =
      this.retryUntil && this.retryUntil > now ? Math.ceil((this.retryUntil - now) / 1000) : 0;

    let status: QuotaSnapshot["status"] = "healthy";
    if (this.proQuotaExceeded) {
      status = "pro_quota_exceeded";
    } else if (this.genericQuotaExceeded || rpmUsed >= this.rpmLimit || rpdUsed >= this.rpdLimit) {
      status = "rate_limited";
    }

    const byModel: Record<string, ModelUsageStats> = {};
    for (const [key, value] of this.modelStats.entries()) {
      byModel[key] = {
        requests: value.requests,
        tokens: { ...value.tokens },
      };
    }

    return {
      status,
      authType: this.authType,
      uptimeSeconds: Math.floor((now - this.startTime) / 1000),
      requests: {
        total: this.totalRequests,
        rpm: {
          used: rpmUsed,
          limit: this.rpmLimit,
          remaining: Math.max(0, this.rpmLimit - rpmUsed),
          windowSeconds: 60,
        },
        rpd: {
          used: rpdUsed,
          limit: this.rpdLimit,
          remaining: Math.max(0, this.rpdLimit - rpdUsed),
          windowHours: 24,
        },
      },
      tokens: { ...this.tokens },
      byModel,
      proQuotaExceeded: this.proQuotaExceeded,
      genericQuotaExceeded: this.genericQuotaExceeded,
      retryAfterSeconds,
      retryUntil: this.retryUntil,
      lastQuotaError: this.lastQuotaError,
      lastQuotaErrorTime: this.lastQuotaErrorTime,
    };
  }

  /**
   * Computes a quota snapshot enriched with remote Google Cloud Code quota buckets if available.
   * @returns Promise resolving to the enriched `QuotaSnapshot`.
   */
  public async getSnapshotAsync(): Promise<QuotaSnapshot> {
    const snapshot = this.getSnapshot();
    try {
      const remote = await remoteQuotaClient.fetchRemoteQuotas();
      if (remote && remote.length > 0) {
        snapshot.remoteModelQuotas = remote;
      }
    } catch {
      // ignore
    }
    return snapshot;
  }

  /**
   * Generates standard HTTP rate-limit response headers for the current RPM window.
   * @returns Record of `x-ratelimit-*` headers.
   */
  public getRateLimitHeaders(): Record<string, string> {
    const snapshot = this.getSnapshot();
    const rpm = snapshot.requests.rpm;
    return {
      "x-ratelimit-limit-requests": String(rpm.limit),
      "x-ratelimit-remaining-requests": String(rpm.remaining),
      "x-ratelimit-reset-requests": String(snapshot.retryAfterSeconds || 60),
    };
  }

  private cleanTimestamps(now: number): void {
    const cutoff = now - 86_400_000;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < cutoff) {
      this.requestTimestamps.shift();
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;

    const anyErr = error as { response?: { data?: unknown }; message?: unknown };
    if (anyErr?.response?.data) {
      const data = anyErr.response.data as { error?: { message?: unknown } } | string;
      if (typeof data === "string") return data;
      if (typeof data === "object" && data !== null && data.error?.message) {
        return String(data.error.message);
      }
      try {
        return JSON.stringify(data);
      } catch {
        // ignore
      }
    }
    if (anyErr?.message) return String(anyErr.message);
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private extractRetryAfterSeconds(error: unknown, errorStr: string): number {
    const anyErr = error as {
      response?: {
        headers?: Record<string, unknown> & { get?: (header: string) => unknown };
      };
    };
    const retryHeader =
      anyErr?.response?.headers?.["retry-after"] || anyErr?.response?.headers?.get?.("retry-after");

    if (retryHeader) {
      const parsedSeconds = parseInt(String(retryHeader), 10);
      if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
        return parsedSeconds;
      }
      const parsedDate = Date.parse(String(retryHeader));
      if (!isNaN(parsedDate)) {
        const diff = Math.ceil((parsedDate - Date.now()) / 1000);
        if (diff > 0) return diff;
      }
    }

    const match = errorStr.match(/retry(?:-after| after| in)?:?\s*(\d+)\s*(?:s|seconds)?/i);
    if (match && match[1]) {
      const sec = parseInt(match[1], 10);
      if (!isNaN(sec) && sec > 0) return sec;
    }

    return 0;
  }
}

export const globalQuotaTracker = new QuotaTracker();
