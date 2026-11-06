/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface RemoteModelQuota {
  modelId: string;
  name?: string;
  tier?: "Flash" | "Flash Lite" | "Pro" | string;
  tokenType: string;
  remainingFraction: number;
  remainingPercentage: number;
  usedPercentage: number;
  remainingAmount?: number;
  limit?: number;
  resetTime?: string;
  resetsIn?: string;
  includedModels?: string[];
}

interface RemoteQuotaBucket {
  resetTime?: string;
  tokenType?: string;
  modelId?: string;
  remainingFraction?: number;
  remainingAmount?: string | number;
}

interface RemoteQuotaResponse {
  buckets?: RemoteQuotaBucket[];
}

function formatResetTime(resetTimeIso: string): string {
  try {
    const resetDate = new Date(resetTimeIso);
    if (isNaN(resetDate.getTime())) return "";
    const diffMs = resetDate.getTime() - Date.now();
    if (diffMs <= 0) return "now";

    const totalMinutes = Math.ceil(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    const hoursStr = hours > 0 ? `${hours}h` : "";
    const minutesStr = minutes > 0 ? `${minutes}m` : "";
    const duration = hoursStr && minutesStr ? `${hoursStr} ${minutesStr}` : hoursStr || minutesStr;

    const timeStr = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
    }).format(resetDate);

    return duration ? `${timeStr} (${duration})` : timeStr;
  } catch {
    return resetTimeIso;
  }
}

function getModelTier(modelId: string): "Flash Lite" | "Flash" | "Pro" {
  const lower = modelId.toLowerCase();
  if (lower.includes("flash-lite") || lower.includes("flash_lite")) {
    return "Flash Lite";
  }
  if (lower.includes("flash")) {
    return "Flash";
  }
  return "Pro";
}

function parseBucketToRemoteQuota(bucket: RemoteQuotaBucket): RemoteModelQuota | null {
  if (!bucket.modelId || bucket.remainingFraction === undefined) return null;

  const fraction = Math.min(Math.max(bucket.remainingFraction, 0), 1);
  const usedFraction = 1 - fraction;
  const usedPercentage = Math.round(usedFraction * 100);
  const remainingPercentage = 100 - usedPercentage;
  const resetTime = bucket.resetTime;
  const resetsIn = resetTime ? formatResetTime(resetTime) : undefined;
  const tier = getModelTier(bucket.modelId);

  let remainingAmount: number | undefined;
  let limit: number | undefined;

  if (bucket.remainingAmount !== undefined) {
    remainingAmount =
      typeof bucket.remainingAmount === "number"
        ? bucket.remainingAmount
        : parseInt(bucket.remainingAmount, 10);
    if (fraction > 0 && !isNaN(remainingAmount)) {
      limit = Math.round(remainingAmount / fraction);
    }
  }

  return {
    modelId: bucket.modelId,
    tier,
    tokenType: bucket.tokenType || "REQUESTS",
    remainingFraction: fraction,
    remainingPercentage,
    usedPercentage,
    remainingAmount,
    limit,
    resetTime,
    resetsIn,
  };
}

function buildTierSummaries(rawItems: RemoteModelQuota[]): RemoteModelQuota[] {
  const tierMap = new Map<
    string,
    { tier: string; remainingFraction: number; resetTime?: string; models: string[] }
  >();
  for (const item of rawItems) {
    const tierName = item.tier || "Flash";
    const existing = tierMap.get(tierName);
    if (!existing) {
      tierMap.set(tierName, {
        tier: tierName,
        remainingFraction: item.remainingFraction,
        resetTime: item.resetTime,
        models: [item.modelId],
      });
    } else {
      if (!existing.models.includes(item.modelId)) {
        existing.models.push(item.modelId);
      }
      if (item.remainingFraction < existing.remainingFraction) {
        existing.remainingFraction = item.remainingFraction;
        existing.resetTime = item.resetTime;
      }
    }
  }

  const tierSummaryItems: RemoteModelQuota[] = [];
  const tierOrder = ["Flash", "Flash Lite", "Pro"];
  for (const tierName of tierOrder) {
    const group = tierMap.get(tierName);
    if (group) {
      const usedPct = Math.round((1 - group.remainingFraction) * 100);
      tierSummaryItems.push({
        modelId: tierName.toLowerCase().replace(/\s+/g, "-"),
        name: tierName,
        tier: tierName,
        tokenType: "REQUESTS",
        remainingFraction: group.remainingFraction,
        remainingPercentage: 100 - usedPct,
        usedPercentage: usedPct,
        resetTime: group.resetTime,
        resetsIn: group.resetTime ? formatResetTime(group.resetTime) : undefined,
        includedModels: group.models,
      });
    }
  }
  return tierSummaryItems;
}

/**
 * Client for fetching upstream Google Cloud Code user quota buckets via OAuth credentials.
 */
export class RemoteQuotaClient {
  private lastFetchTime = 0;
  private cachedQuotas: RemoteModelQuota[] = [];
  private cacheTtlMs = 15_000;

  /**
   * Fetches and caches remote model quota buckets from Google Cloud Code API.
   * @returns Array of tier summaries and individual remote model quota buckets.
   */
  public async fetchRemoteQuotas(): Promise<RemoteModelQuota[]> {
    const now = Date.now();
    if (this.cachedQuotas.length > 0 && now - this.lastFetchTime < this.cacheTtlMs) {
      return this.cachedQuotas;
    }

    const token = await this.getOAuthAccessToken();
    if (!token) {
      return this.cachedQuotas;
    }

    const projectId = this.resolveProjectId();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(projectId ? { project: projectId } : {}),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return this.cachedQuotas;
      }

      const data = (await res.json()) as RemoteQuotaResponse;
      if (!data.buckets || !Array.isArray(data.buckets)) {
        return this.cachedQuotas;
      }

      const rawItems = data.buckets
        .map(parseBucketToRemoteQuota)
        .filter((item): item is RemoteModelQuota => item !== null);
      const tierSummaryItems = buildTierSummaries(rawItems);

      this.cachedQuotas = [...tierSummaryItems, ...rawItems];
      this.lastFetchTime = now;
      return this.cachedQuotas;
    } catch {
      return this.cachedQuotas;
    }
  }

  /**
   * Resolves the Google Cloud project ID from standard environment variables.
   *
   * @param env - Optional environment variables dictionary (defaults to process.env).
   * @returns Configured project ID string or undefined.
   */
  public resolveProjectId(env: NodeJS.ProcessEnv = process.env): string | undefined {
    return (
      env.GOOGLE_CLOUD_PROJECT ||
      env.GOOGLE_CLOUD_PROJECT_ID ||
      env.GEMINI_PROJECT_ID ||
      env.DEFAULT_GOOGLE_CLOUD_PROJECT ||
      undefined
    );
  }

  private async getOAuthAccessToken(): Promise<string | null> {
    const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
    try {
      if (!fs.existsSync(credsPath)) return null;
      const raw = fs.readFileSync(credsPath, "utf-8");
      const creds = JSON.parse(raw) as { access_token?: string };
      if (creds && typeof creds.access_token === "string") {
        return creds.access_token;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

export const remoteQuotaClient = new RemoteQuotaClient();
