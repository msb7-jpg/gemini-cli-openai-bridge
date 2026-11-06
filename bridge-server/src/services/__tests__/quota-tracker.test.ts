/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import { QuotaTracker } from "../quota-tracker.js";

describe("QuotaTracker", () => {
  let tracker: QuotaTracker;

  beforeEach(() => {
    tracker = new QuotaTracker({ authType: "oauth", rpmLimit: 60, rpdLimit: 1000 });
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
});
