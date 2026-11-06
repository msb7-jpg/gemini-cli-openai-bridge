/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QuotaSnapshot, ModelUsageStats } from "../models-and-quota/quota-tracker.service.js";
import type { RemoteModelQuota } from "../models-and-quota/remote-quota.client.js";
import { checkBridgeHealth } from "./health-poller.js";
import { formatUptime, readPidFile } from "./process-manager.js";

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

function renderProgressBar(used: number, limit: number, width = 20): string {
  if (limit <= 0) return `[${"█".repeat(width)}]`;
  const ratio = Math.min(Math.max(used / limit, 0), 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  if (ratio >= 1.0) {
    return red(`[${bar}]`);
  } else if (ratio >= 0.8) {
    return yellow(`[${bar}]`);
  }
  return green(`[${bar}]`);
}

function renderRemoteQuotasSection(remoteModelQuotas?: RemoteModelQuota[]): void {
  if (!remoteModelQuotas || !Array.isArray(remoteModelQuotas) || remoteModelQuotas.length === 0) {
    return;
  }

  console.log("");
  console.log(`  ${bold("Google Cloud Remote Quotas & Reset Time (Enterprise):")}`);

  const tierSummaries = remoteModelQuotas.filter(
    (bucket: RemoteModelQuota) =>
      bucket.name && bucket.includedModels && bucket.includedModels.length > 0,
  );
  const itemsToDisplay = tierSummaries.length > 0 ? tierSummaries : remoteModelQuotas;

  for (const bucket of itemsToDisplay) {
    const displayName = bucket.name || bucket.modelId;
    const usedPct = bucket.usedPercentage ?? 100 - (bucket.remainingPercentage ?? 100);
    const bar = renderProgressBar(usedPct, 100, 20);
    const resetInfo = bucket.resetsIn ? `Resets: ${bucket.resetsIn}` : "";
    const pctStr = `${usedPct}%`.padEnd(5);
    const statusColor = usedPct >= 100 ? red : usedPct >= 80 ? yellow : green;

    console.log(
      `    • ${bold(displayName.padEnd(12))} ${bar} ${statusColor(pctStr)}  ${dim(resetInfo)}`,
    );
    if (
      bucket.includedModels &&
      Array.isArray(bucket.includedModels) &&
      bucket.includedModels.length > 0
    ) {
      console.log(`      ${dim(`↳ (${bucket.includedModels.join(", ")})`)}`);
    }
  }
}

/**
 * Renders the ANSI terminal dashboard for a `QuotaSnapshot`.
 * @param data - Quota and token usage snapshot from `/v1/quota`.
 * @param host - Active server host.
 * @param port - Active server port.
 */
function renderQuotaDashboard(data: QuotaSnapshot, host: string, port: number): void {
  const statusColor =
    data.status === "healthy"
      ? green(bold("HEALTHY (Normal)"))
      : data.status === "pro_quota_exceeded"
        ? yellow(bold("PRO QUOTA EXCEEDED (Fallback active)"))
        : red(bold("RATE LIMITED (Exceeded)"));

  console.log(`${bold("══════════════════════════════════════════════════════")}`);
  console.log(
    `  ${bold("Gemini Bridge Quota & Usage Monitor")}  ${dim(`(http://${host}:${port})`)}`,
  );
  console.log(`${bold("══════════════════════════════════════════════════════")}`);
  console.log(`  ${cyan("Status:")}         ${statusColor}`);
  console.log(`  ${cyan("Auth Type:")}      ${data.authType || "unknown"}`);
  console.log(
    `  ${cyan("Uptime:")}         ${formatUptime(Date.now() - (data.uptimeSeconds || 0) * 1000)}`,
  );
  console.log(`  ${cyan("Total Requests:")} ${data.requests?.total ?? 0}`);
  console.log("");

  const rpm = data.requests?.rpm;
  if (rpm) {
    const rpmBar = renderProgressBar(rpm.used, rpm.limit, 20);
    console.log(`  ${bold("Requests Per Minute (RPM):")}`);
    console.log(
      `    ${rpmBar} ${bold(`${rpm.used}/${rpm.limit}`)} reqs  ${dim(`(${rpm.remaining} remaining in this window)`)}`,
    );
  }

  const rpd = data.requests?.rpd;
  if (rpd) {
    const rpdBar = renderProgressBar(rpd.used, rpd.limit, 20);
    console.log(`  ${bold("Requests Per Day (RPD):")}`);
    console.log(
      `    ${rpdBar} ${bold(`${rpd.used}/${rpd.limit}`)} reqs  ${dim(`(${rpd.remaining} remaining today)`)}`,
    );
  }

  console.log("");
  const tokens = data.tokens;
  if (tokens) {
    console.log(`  ${bold("Tokens Consumed (Session):")}`);
    console.log(`    ${cyan("Prompt:")}     ${(tokens.promptTokens || 0).toLocaleString()} tokens`);
    console.log(
      `    ${cyan("Candidate:")}  ${(tokens.completionTokens || 0).toLocaleString()} tokens`,
    );
    if (tokens.cachedTokens) {
      console.log(
        `    ${cyan("Cached:")}     ${(tokens.cachedTokens || 0).toLocaleString()} tokens`,
      );
    }
    console.log(
      `    ${cyan("Total:")}      ${bold((tokens.totalTokens || 0).toLocaleString())} tokens`,
    );
  }

  if (data.proQuotaExceeded) {
    console.log("");
    console.log(
      yellow(
        `  ⚠️  ${bold("Pro Quota Exceeded:")} Requests will be routed to fallback model (e.g. Flash).`,
      ),
    );
    if (data.retryAfterSeconds > 0) {
      console.log(yellow(`     Estimated recovery time: ${bold(`${data.retryAfterSeconds}s`)}`));
    }
  }

  renderRemoteQuotasSection(data.remoteModelQuotas);

  if (data.byModel && Object.keys(data.byModel).length > 0) {
    console.log("");
    console.log(`  ${bold("Usage by Model (This Bridge Session):")}`);
    for (const [modelName, modelStats] of Object.entries<ModelUsageStats>(data.byModel)) {
      console.log(
        `    • ${bold(modelName)}: ${modelStats.requests} reqs, ${(modelStats.tokens?.totalTokens || 0).toLocaleString()} tokens`,
      );
    }
  }

  console.log(`${bold("══════════════════════════════════════════════════════")}`);
}

/**
 * Fetches `/v1/quota` from the running bridge server and prints the formatted terminal dashboard.
 * @param port - Fallback port number.
 * @param host - Fallback host address.
 */
export async function handleQuota(port: number, host = "127.0.0.1"): Promise<void> {
  const pidInfo = readPidFile();
  const effectivePort = pidInfo?.port || port;
  const effectiveHost = pidInfo?.host || host;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://${effectiveHost}:${effectivePort}/v1/quota`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.log(red(`Error querying quota: HTTP ${res.status} ${res.statusText}`));
      return;
    }

    const data = await res.json();
    renderQuotaDashboard(data as QuotaSnapshot, effectiveHost, effectivePort);
  } catch {
    const health = await checkBridgeHealth(effectivePort, effectiveHost, 500);
    if (!health.ok) {
      console.log(red(`${bold("○ Gemini Bridge")} is ${bold("INACTIVE")}`));
      console.log(dim(`To start the bridge run: ${bold("gemini-bridge")}`));
    } else {
      console.log(
        yellow(
          `The server is responding on port ${effectivePort}, but endpoint /v1/quota is not available.`,
        ),
      );
    }
  }
}
