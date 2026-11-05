/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { remoteQuotaClient, type RemoteModelQuota } from './remote-quota-client.js';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface ModelUsageStats {
  requests: number;
  tokens: TokenUsage;
}

export interface QuotaWindowStats {
  used: number;
  limit: number;
  remaining: number;
}

export interface QuotaSnapshot {
  status: 'healthy' | 'pro_quota_exceeded' | 'rate_limited';
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

export class QuotaTracker {
  private startTime: number = Date.now();
  private authType: string = 'unknown';
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
    this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '60', 10);
    this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || '1000', 10);

    if (options?.authType) {
      this.setAuthType(options.authType);
    }

    if (options?.rpmLimit) this.rpmLimit = options.rpmLimit;
    if (options?.rpdLimit) this.rpdLimit = options.rpdLimit;
  }

  public setAuthType(authType: string): void {
    this.authType = authType;
    const lower = authType.toLowerCase();

    // Set intelligent defaults based on Gemini CLI docs & auth types
    if (lower.includes('oauth') || lower.includes('code_assist') || lower.includes('cloud')) {
      this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '60', 10);
      this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || '1000', 10);
    } else if (lower.includes('api_key') || lower.includes('gemini')) {
      this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '15', 10);
      this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || '1500', 10);
    } else {
      this.rpmLimit = parseInt(process.env.GEMINI_RPM_LIMIT || '60', 10);
      this.rpdLimit = parseInt(process.env.GEMINI_RPD_LIMIT || '1000', 10);
    }
  }

  public getAuthType(): string {
    return this.authType;
  }

  public recordRequestStart(): void {
    const now = Date.now();
    this.totalRequests++;
    this.requestTimestamps.push(now);
    this.cleanTimestamps(now);
  }

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

  public recordQuotaError(error: unknown): void {
    const errorStr = this.extractErrorMessage(error);
    const now = Date.now();

    this.lastQuotaError = errorStr;
    this.lastQuotaErrorTime = now;

    const isPro =
      errorStr.includes("Quota exceeded for quota metric 'Gemini") &&
      errorStr.includes("Pro Requests'");
    const isGeneric =
      errorStr.includes('Quota exceeded for quota metric') ||
      errorStr.toLowerCase().includes('resource_exhausted') ||
      errorStr.includes('429');

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
      // Default retry period of 60s if not specified
      this.retryUntil = now + 60_000;
    }
  }

  public getSnapshot(): QuotaSnapshot {
    const now = Date.now();
    this.cleanTimestamps(now);

    // Auto-reset retry cooldown if time has passed
    if (this.retryUntil && now >= this.retryUntil) {
      this.proQuotaExceeded = false;
      this.genericQuotaExceeded = false;
      this.retryUntil = null;
    }

    const rpmUsed = this.requestTimestamps.filter((t) => t >= now - 60_000).length;
    const rpdUsed = this.requestTimestamps.filter((t) => t >= now - 86_400_000).length;

    const retryAfterSeconds =
      this.retryUntil && this.retryUntil > now
        ? Math.ceil((this.retryUntil - now) / 1000)
        : 0;

    let status: QuotaSnapshot['status'] = 'healthy';
    if (this.proQuotaExceeded) {
      status = 'pro_quota_exceeded';
    } else if (this.genericQuotaExceeded || rpmUsed >= this.rpmLimit || rpdUsed >= this.rpdLimit) {
      status = 'rate_limited';
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

  public getRateLimitHeaders(): Record<string, string> {
    const snapshot = this.getSnapshot();
    const rpm = snapshot.requests.rpm;
    return {
      'x-ratelimit-limit-requests': String(rpm.limit),
      'x-ratelimit-remaining-requests': String(rpm.remaining),
      'x-ratelimit-reset-requests': String(snapshot.retryAfterSeconds || 60),
    };
  }

  private cleanTimestamps(now: number): void {
    const cutoff = now - 86_400_000;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < cutoff) {
      this.requestTimestamps.shift();
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;

    const anyErr = error as any;
    if (anyErr?.response?.data) {
      const data = anyErr.response.data;
      if (typeof data === 'string') return data;
      if (data.error?.message) return String(data.error.message);
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
    const anyErr = error as any;
    const retryHeader =
      anyErr?.response?.headers?.['retry-after'] ||
      anyErr?.response?.headers?.get?.('retry-after');

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

    // Try parsing from message text: e.g. "Please retry after 42 seconds" or "retry in 30s"
    const match = errorStr.match(/retry(?:-after| after| in)?:?\s*(\d+)\s*(?:s|seconds)?/i);
    if (match && match[1]) {
      const sec = parseInt(match[1], 10);
      if (!isNaN(sec) && sec > 0) return sec;
    }

    return 0;
  }
}

export const globalQuotaTracker = new QuotaTracker();
