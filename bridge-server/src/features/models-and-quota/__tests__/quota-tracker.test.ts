/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QuotaTracker } from "../quota-tracker.service.js";
import { remoteQuotaClient, type RemoteModelQuota } from "../remote-quota.client.js";
import {
  QuotaSnapshotSchema,
  TokenUsageSchema,
  ModelsListResponseSchema,
} from "../quota.schema.js";

describe("QuotaTracker & Quota Schemas", () => {
  let tracker: QuotaTracker;

  beforeEach(() => {
    tracker = new QuotaTracker({ authType: "oauth", rpmLimit: 60, rpdLimit: 1000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks requests and computes remaining RPM and RPD", () => {
    tracker.recordRequestStart();
    tracker.recordRequestStart();

    const snapshot = tracker.getSnapshot();
    expect(snapshot.requests.total).toBe(2);
    expect(snapshot.requests.rpm.used).toBe(2);
    expect(snapshot.requests.rpm.remaining).toBe(58);
    expect(snapshot.requests.rpd.used).toBe(2);
    expect(snapshot.requests.rpd.remaining).toBe(998);
    expect(snapshot.status).toBe("healthy");
  });

  it("tracks token usage per model and globally", () => {
    tracker.recordUsage("gemini-2.5-pro", {
      promptTokens: 100,
      completionTokens: 50,
      cachedTokens: 20,
    });
    tracker.recordUsage("gemini-3.8-flash", {
      promptTokens: 200,
      completionTokens: 80,
    });

    const snapshot = tracker.getSnapshot();
    expect(snapshot.tokens.promptTokens).toBe(300);
    expect(snapshot.tokens.completionTokens).toBe(130);
    expect(snapshot.tokens.cachedTokens).toBe(20);
    expect(snapshot.tokens.totalTokens).toBe(430);

    expect(snapshot.byModel["gemini-2.5-pro"].tokens.totalTokens).toBe(150);
    expect(snapshot.byModel["gemini-3.8-flash"].tokens.totalTokens).toBe(280);
  });

  it("detects pro quota exceeded error and extracts retry-after", () => {
    const error = {
      response: {
        headers: { "retry-after": "45" },
        data: {
          error: {
            message:
              "Quota exceeded for quota metric 'Gemini Pro Requests' and limit 'Requests per minute'",
          },
        },
      },
    };

    tracker.recordQuotaError(error);

    const snapshot = tracker.getSnapshot();
    expect(snapshot.proQuotaExceeded).toBe(true);
    expect(snapshot.status).toBe("pro_quota_exceeded");
    expect(snapshot.retryAfterSeconds).toBeGreaterThanOrEqual(40);
    expect(snapshot.retryAfterSeconds).toBeLessThanOrEqual(45);
  });

  it("provides standard rate limit headers", () => {
    tracker.recordRequestStart();
    const headers = tracker.getRateLimitHeaders();
    expect(headers["x-ratelimit-limit-requests"]).toBe("60");
    expect(headers["x-ratelimit-remaining-requests"]).toBe("59");
    expect(headers["x-ratelimit-reset-requests"]).toBeDefined();
  });

  it("validates TokenUsage, QuotaSnapshot, and ModelsListResponse Zod 4 schemas", () => {
    const usage = TokenUsageSchema.parse({});
    expect(usage.promptTokens).toBe(0);
    expect(usage.completionTokens).toBe(0);
    expect(usage.cachedTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);

    const snapshot = {
      status: "healthy",
      authType: "oauth",
      uptimeSeconds: 3600,
      requests: {
        total: 10,
        rpm: { used: 2, limit: 60, remaining: 58, windowSeconds: 60 },
        rpd: { used: 10, limit: 1000, remaining: 990, windowHours: 24 },
      },
      tokens: {
        promptTokens: 100,
        completionTokens: 50,
        cachedTokens: 0,
        totalTokens: 150,
      },
      byModel: {
        "gemini-2.5-flash": {
          requests: 10,
          tokens: {
            promptTokens: 100,
            completionTokens: 50,
            cachedTokens: 0,
            totalTokens: 150,
          },
        },
      },
      remoteModelQuotas: [
        { model: "gemini-2.5-pro", percentage: 0.8, resetTime: "2026-11-07T00:00:00Z" },
      ],
      proQuotaExceeded: false,
      genericQuotaExceeded: false,
      retryAfterSeconds: 0,
      retryUntil: null,
      lastQuotaError: null,
      lastQuotaErrorTime: null,
    };

    const parsedSnapshot = QuotaSnapshotSchema.parse(snapshot);
    expect(parsedSnapshot.status).toBe("healthy");
    expect(parsedSnapshot.requests.rpm.remaining).toBe(58);
    expect(parsedSnapshot.remoteModelQuotas?.[0].model).toBe("gemini-2.5-pro");

    const modelsResponse = ModelsListResponseSchema.parse({
      object: "list",
      data: [
        {
          id: "gemini-2.5-flash",
          object: "model",
          created: 1700000000,
          owned_by: "google",
        },
      ],
    });
    expect(modelsResponse.object).toBe("list");
    expect(modelsResponse.data).toHaveLength(1);
    expect(modelsResponse.data[0].id).toBe("gemini-2.5-flash");
  });
});

describe("QuotaTracker Remote Quota Integration", () => {
  let tracker: QuotaTracker;

  beforeEach(() => {
    tracker = new QuotaTracker({ authType: "oauth", rpmLimit: 60, rpdLimit: 1000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getSnapshotAsync enriches RPD limit and remaining from remote quotas when available", async () => {
    tracker.recordRequestStart();
    tracker.recordRequestStart();

    const mockRemoteQuotas: RemoteModelQuota[] = [
      {
        modelId: "flash",
        name: "Flash",
        tier: "Flash",
        tokenType: "REQUESTS",
        remainingFraction: 0.95,
        remainingPercentage: 95,
        usedPercentage: 5,
        limit: 2000,
        remainingAmount: 1900,
        resetsIn: "12h 30m",
        resetTime: "2026-11-12T08:00:00Z",
        includedModels: ["gemini-2.5-flash"],
      },
    ];

    vi.spyOn(remoteQuotaClient, "fetchRemoteQuotas").mockResolvedValue(mockRemoteQuotas);

    const snapshot = await tracker.getSnapshotAsync();
    expect(snapshot.requests.rpd.used).toBe(2);
    expect(snapshot.requests.rpd.limit).toBe(2000);
    expect(snapshot.requests.rpd.remaining).toBe(1900);
    expect(snapshot.requests.rpd.resetsIn).toBe("12h 30m");
    expect(snapshot.requests.rpd.resetTime).toBe("2026-11-12T08:00:00Z");
    expect(snapshot.status).toBe("healthy");
  });

  it("getSnapshotAsync sets hasExplicitLimit to false when remote limit is undefined and no env limit", async () => {
    for (let count = 0; count < 10; count++) {
      tracker.recordRequestStart();
    }

    const mockRemoteQuotas: RemoteModelQuota[] = [
      {
        modelId: "flash",
        name: "Flash",
        tier: "Flash",
        tokenType: "REQUESTS",
        remainingFraction: 0.8,
        remainingPercentage: 80,
        usedPercentage: 20,
        includedModels: ["gemini-2.5-flash"],
      },
    ];

    vi.spyOn(remoteQuotaClient, "fetchRemoteQuotas").mockResolvedValue(mockRemoteQuotas);

    const snapshot = await tracker.getSnapshotAsync();
    expect(snapshot.requests.rpd.hasExplicitLimit).toBe(false);
    expect(snapshot.requests.rpd.used).toBe(10);
  });

  it("getSnapshotAsync respects process.env.GEMINI_RPD_LIMIT when set", async () => {
    process.env.GEMINI_RPD_LIMIT = "2500";
    try {
      vi.spyOn(remoteQuotaClient, "fetchRemoteQuotas").mockResolvedValue([
        {
          modelId: "flash",
          name: "Flash",
          tier: "Flash",
          tokenType: "REQUESTS",
          usedPercentage: 0,
          remainingPercentage: 100,
          remainingFraction: 1.0,
          resetTime: "2026-11-12T00:00:00Z",
          includedModels: ["gemini-2.5-flash"],
        },
      ]);

      const snapshot = await tracker.getSnapshotAsync();
      expect(snapshot.requests.rpd.hasExplicitLimit).toBe(true);
    } finally {
      delete process.env.GEMINI_RPD_LIMIT;
    }
  });

  it("status stays healthy when remote quota has capacity, even if request count > 1000", async () => {
    // Inject > 1000 requests into requestTimestamps
    const now = Date.now();
    for (let count = 0; count < 1200; count++) {
      // spread over last 12 hours so RPM is not exceeded (rpmLimit is 60)
      tracker["requestTimestamps"].push(now - 1000 * 60 - count * 10000);
    }

    // getSnapshot() status is not rate_limited just because rpdUsed >= 1000
    const synchronousSnapshot = tracker.getSnapshot();
    expect(synchronousSnapshot.requests.rpd.used).toBeGreaterThanOrEqual(1200);
    expect(synchronousSnapshot.status).toBe("healthy");

    // getSnapshotAsync() with capacity also remains healthy
    const mockRemoteQuotas: RemoteModelQuota[] = [
      {
        modelId: "flash",
        name: "Flash",
        tier: "Flash",
        tokenType: "REQUESTS",
        remainingFraction: 0.5,
        remainingPercentage: 50,
        usedPercentage: 50,
        includedModels: ["gemini-2.5-flash"],
      },
    ];
    vi.spyOn(remoteQuotaClient, "fetchRemoteQuotas").mockResolvedValue(mockRemoteQuotas);

    const asynchronousSnapshot = await tracker.getSnapshotAsync();
    expect(asynchronousSnapshot.status).toBe("healthy");

    // When remote quota is exhausted across all tiers, status becomes rate_limited
    const exhaustedRemoteQuotas: RemoteModelQuota[] = [
      {
        modelId: "flash",
        name: "Flash",
        tier: "Flash",
        tokenType: "REQUESTS",
        remainingFraction: 0,
        remainingPercentage: 0,
        usedPercentage: 100,
        includedModels: ["gemini-2.5-flash"],
      },
    ];
    vi.spyOn(remoteQuotaClient, "fetchRemoteQuotas").mockResolvedValue(exhaustedRemoteQuotas);

    const exhaustedSnapshot = await tracker.getSnapshotAsync();
    expect(exhaustedSnapshot.status).toBe("rate_limited");
  });
});
