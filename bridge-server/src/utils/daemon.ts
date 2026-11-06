/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import type { QuotaSnapshot, ModelUsageStats } from "../services/quota-tracker.js";
import type { RemoteModelQuota } from "../services/remote-quota-client.js";

const GEMINI_DIR = path.join(os.homedir(), ".gemini");
const PID_FILE = path.join(GEMINI_DIR, "bridge.pid");
const LOG_FILE = path.join(GEMINI_DIR, "bridge.log");

export interface PidInfo {
  pid: number;
  port: number;
  host: string;
  startTime: number;
}

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

export class TerminalSpinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private index = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private message: string;
  private startTime: number = Date.now();
  private isTTY = Boolean(process.stdout.isTTY);

  constructor(message: string) {
    this.message = message;
  }

  public start(): void {
    this.startTime = Date.now();
    if (!this.isTTY) {
      console.log(`${this.message}...`);
      return;
    }
    this.render();
    this.intervalId = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      this.render();
    }, 80);
  }

  public update(message: string): void {
    this.message = message;
    if (this.isTTY) this.render();
  }

  private render(): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const frame = this.frames[this.index];
    process.stdout.write(`\r\x1b[K${cyan(frame)} ${this.message} ${dim(`(${elapsed}s)`)}`);
  }

  public stop(clear = true): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.isTTY && clear) {
      process.stdout.write("\r\x1b[K");
    }
  }
}

function ensureGeminiDir(): void {
  if (!fs.existsSync(GEMINI_DIR)) {
    fs.mkdirSync(GEMINI_DIR, { recursive: true });
  }
}

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPidFile(customPidPath?: string): PidInfo | null {
  const filePath = customPidPath || process.env.GEMINI_BRIDGE_PID_FILE || PID_FILE;
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return null;
    const parsed = JSON.parse(content) as PidInfo;
    if (parsed && typeof parsed.pid === "number") {
      return parsed;
    }
  } catch {
    // corrupted or unreadable file
  }
  return null;
}

export function writePidFile(info: PidInfo, customPidPath?: string): void {
  const filePath = customPidPath || process.env.GEMINI_BRIDGE_PID_FILE || PID_FILE;
  if (!customPidPath && !process.env.GEMINI_BRIDGE_PID_FILE) {
    ensureGeminiDir();
  } else {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  fs.writeFileSync(filePath, JSON.stringify(info, null, 2), "utf-8");
}

export function removePidFile(customPidPath?: string): void {
  const filePath = customPidPath || process.env.GEMINI_BRIDGE_PID_FILE || PID_FILE;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}

export async function checkBridgeHealth(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 1500,
): Promise<{ ok: boolean; version?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      return { ok: true, version: data.version };
    }
  } catch {
    // offline or unreachable
  }
  return { ok: false };
}

export function formatUptime(startTime: number): string {
  const diffSec = Math.floor((Date.now() - startTime) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s`;
  const diffHours = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  return `${diffHours}h ${remMin}m`;
}

export async function handleStatus(port: number, host = "127.0.0.1"): Promise<void> {
  const pidInfo = readPidFile();
  const effectivePort = pidInfo?.port || port;
  const effectiveHost = pidInfo?.host || host;

  const health = await checkBridgeHealth(effectivePort, effectiveHost);

  if (pidInfo && isPidRunning(pidInfo.pid) && health.ok) {
    console.log(green(`${bold("● Gemini Bridge")} is ${bold("ACTIVE")} (Online)`));
    console.log(`  ${cyan("PID:")}       ${pidInfo.pid}`);
    console.log(`  ${cyan("Port:")}      ${effectivePort}`);
    console.log(`  ${cyan("Uptime:")}    ${formatUptime(pidInfo.startTime)}`);
    if (health.version) {
      console.log(`  ${cyan("Version:")}   ${health.version}`);
    }
    console.log(
      `  ${cyan("OpenAI:")}    http://${effectiveHost}:${effectivePort}/v1/chat/completions`,
    );
    console.log(`  ${cyan("Anthropic:")} http://${effectiveHost}:${effectivePort}/v1/messages`);
    console.log(`  ${cyan("Models:")}    http://${effectiveHost}:${effectivePort}/v1/models`);
    console.log(`  ${cyan("Logs:")}      ${LOG_FILE}`);
    console.log("");
    console.log(
      dim(
        `Commands: 'gemini-bridge quota' | 'gemini-bridge stop' | 'gemini-bridge restart' | 'gemini-bridge logs'`,
      ),
    );
  } else if (health.ok) {
    // Process running without PID file or orphan
    console.log(
      yellow(
        `${bold("● Gemini Bridge")} is responding on port ${effectivePort}, but without a recent PID record.`,
      ),
    );
    console.log(
      `  ${cyan("OpenAI:")}    http://${effectiveHost}:${effectivePort}/v1/chat/completions`,
    );
  } else {
    // Stale PID cleanup
    if (pidInfo && !isPidRunning(pidInfo.pid)) {
      removePidFile();
    }
    console.log(red(`${bold("○ Gemini Bridge")} is ${bold("INACTIVE")}`));
    console.log(
      dim(`To start in background run: ${bold("gemini-bridge")} or ${bold("gemini-bridge start")}`),
    );
  }
}

export async function handleStop(port: number, host = "127.0.0.1"): Promise<void> {
  const pidInfo = readPidFile();

  if (!pidInfo || !isPidRunning(pidInfo.pid)) {
    const health = await checkBridgeHealth(port, host, 500);
    if (!health.ok) {
      removePidFile();
      console.log(yellow("○ Gemini Bridge is already inactive."));
      return;
    }
  }

  const pid = pidInfo?.pid;
  if (!pid) {
    console.log(yellow(`⚠ Could not determine Gemini Bridge PID on port ${port}.`));
    return;
  }

  console.log(`Shutting down Gemini Bridge (PID ${pid})...`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already exited
  }

  // Wait up to 3 seconds for graceful shutdown
  let exited = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!isPidRunning(pid)) {
      exited = true;
      break;
    }
  }

  // Force kill if necessary
  if (!exited && isPidRunning(pid)) {
    console.log(yellow(`Force killing (SIGKILL) PID ${pid}...`));
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }

  removePidFile();
  console.log(green(`✓ Gemini Bridge stopped successfully.`));
}

export function handleLogs(follow = false, lines = 40): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(yellow(`Log file does not exist yet at ${LOG_FILE}`));
    return;
  }

  const content = fs.readFileSync(LOG_FILE, "utf-8");
  const allLines = content.split("\n");
  const displayLines = allLines.slice(-lines).join("\n");
  console.log(displayLines);

  if (follow) {
    console.log(dim("\n--- Following logs in real time (Ctrl+C to exit) ---"));
    let currentSize = fs.statSync(LOG_FILE).size;
    fs.watchFile(LOG_FILE, { interval: 500 }, (curr) => {
      if (curr.size > currentSize) {
        const stream = fs.createReadStream(LOG_FILE, {
          start: currentSize,
          end: curr.size,
          encoding: "utf-8",
        });
        stream.on("data", (chunk) => process.stdout.write(chunk));
        currentSize = curr.size;
      }
    });
  }
}

export async function startDaemon(
  port: number,
  host: string,
  extraArgs: string[],
  scriptPath: string,
): Promise<void> {
  ensureGeminiDir();

  // 1. Check if already running
  const pidInfo = readPidFile();
  if (pidInfo && isPidRunning(pidInfo.pid)) {
    const health = await checkBridgeHealth(pidInfo.port, pidInfo.host, 1000);
    if (health.ok) {
      console.log(green(`${bold("● Gemini Bridge")} is already running!`));
      console.log(`  ${cyan("PID:")}       ${pidInfo.pid}`);
      console.log(`  ${cyan("Port:")}      ${pidInfo.port}`);
      console.log(`  ${cyan("Uptime:")}    ${formatUptime(pidInfo.startTime)}`);
      console.log(
        `  ${cyan("OpenAI:")}    http://${pidInfo.host}:${pidInfo.port}/v1/chat/completions`,
      );
      console.log(`  ${cyan("Anthropic:")} http://${pidInfo.host}:${pidInfo.port}/v1/messages`);
      console.log(`  ${cyan("Models:")}    http://${pidInfo.host}:${pidInfo.port}/v1/models`);
      return;
    }
  }

  // Also check if port is currently responding
  const currentHealth = await checkBridgeHealth(port, host, 800);
  if (currentHealth.ok) {
    console.log(
      green(`${bold("● Gemini Bridge")} is already active and responding on port ${port}.`),
    );
    return;
  }

  // 2. Open log file
  const logStartOffset = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
  const logFd = fs.openSync(LOG_FILE, "a");

  // 3. Prepare child args
  const childArgs = [
    scriptPath,
    ...extraArgs.filter(
      (arg) =>
        arg !== "start" &&
        arg !== "status" &&
        arg !== "stop" &&
        arg !== "restart" &&
        arg !== "logs" &&
        !arg.startsWith("--foreground") &&
        !arg.startsWith("-f"),
    ),
    "--server-process",
    "--foreground",
  ];

  const spinner = new TerminalSpinner("Starting Gemini Bridge and authenticating");
  spinner.start();

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });

  const childPid = child.pid;
  if (!childPid) {
    spinner.stop(true);
    console.error(red("Failed to spawn bridge process."));
    process.exit(1);
  }

  try {
    fs.closeSync(logFd);
  } catch {
    // ignore
  }

  child.unref();

  writePidFile({
    pid: childPid,
    port,
    host,
    startTime: Date.now(),
  });

  // 4. Wait for health check confirmation with spinner
  const timeoutSec = Math.max(10, Number(process.env.GEMINI_BRIDGE_STARTUP_TIMEOUT) || 45);
  const pollIntervalMs = 250;
  const maxAttempts = Math.round((timeoutSec * 1000) / pollIntervalMs);

  let online = false;
  let version = "";
  const loopStart = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    if (!isPidRunning(childPid)) {
      break;
    }

    const elapsed = (Date.now() - loopStart) / 1000;
    if (elapsed >= 25) {
      spinner.update("Waiting for server readiness & network binding");
    } else if (elapsed >= 12) {
      spinner.update("Refreshing credentials & initializing provider models");
    } else if (elapsed >= 5) {
      spinner.update("Loading modules & configuring Gemini client");
    }

    const health = await checkBridgeHealth(port, host, 800);
    if (health.ok) {
      online = true;
      version = health.version || "";
      break;
    }
  }

  spinner.stop(true);

  if (online) {
    console.log(green(`${bold("✓ Gemini Bridge started successfully (detached)!")}`));
    console.log(`  ${cyan("PID:")}       ${childPid}`);
    console.log(`  ${cyan("Port:")}      ${port}`);
    if (version) {
      console.log(`  ${cyan("Version:")}   ${version}`);
    }
    console.log(`  ${cyan("OpenAI:")}    http://${host}:${port}/v1/chat/completions`);
    console.log(`  ${cyan("Anthropic:")} http://${host}:${port}/v1/messages`);
    console.log(`  ${cyan("Models:")}    http://${host}:${port}/v1/models`);
    console.log(`  ${cyan("Quota:")}     http://${host}:${port}/v1/quota`);
    console.log(`  ${cyan("Logs:")}      ${LOG_FILE}`);
    console.log("");
    console.log(dim(`Useful commands:`));
    console.log(dim(`  gemini-bridge status   (check status)`));
    console.log(dim(`  gemini-bridge quota    (check usage and quota)`));
    console.log(dim(`  gemini-bridge stop     (stop server)`));
    console.log(dim(`  gemini-bridge restart  (restart server)`));
    console.log(dim(`  gemini-bridge logs     (view logs)`));
  } else {
    if (!isPidRunning(childPid)) {
      console.error(red("❌ The bridge server process exited unexpectedly during startup."));
    } else {
      console.error(red(`❌ The bridge server did not respond within ${timeoutSec} seconds.`));
      try {
        process.kill(childPid, "SIGTERM");
      } catch {
        // ignore
      }

      const termWaitStart = Date.now();
      while (isPidRunning(childPid) && Date.now() - termWaitStart < 1000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (isPidRunning(childPid)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // ignore
        }
      }
    }

    removePidFile();

    if (fs.existsSync(LOG_FILE)) {
      const currentSize = fs.statSync(LOG_FILE).size;
      if (currentSize > logStartOffset) {
        try {
          const fd = fs.openSync(LOG_FILE, "r");
          const bytesToRead = currentSize - logStartOffset;
          const buffer = Buffer.alloc(bytesToRead);
          fs.readSync(fd, buffer, 0, bytesToRead, logStartOffset);
          fs.closeSync(fd);

          const content = buffer.toString("utf-8");
          const lines = content.split("\n").filter((line) => line.trim().length > 0);
          if (lines.length > 0) {
            console.error(yellow("\nStartup logs:"));
            console.error(lines.slice(-25).join("\n"));
          } else {
            console.error(yellow("\nLast log lines:"));
            handleLogs(false, 15);
          }
        } catch {
          console.error(yellow("\nLast log lines:"));
          handleLogs(false, 15);
        }
      } else {
        console.error(yellow("\nLast log lines:"));
        handleLogs(false, 15);
      }
    }

    process.exit(1);
  }
}

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

export function renderQuotaDashboard(data: QuotaSnapshot, host: string, port: number): void {
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

  if (
    data.remoteModelQuotas &&
    Array.isArray(data.remoteModelQuotas) &&
    data.remoteModelQuotas.length > 0
  ) {
    console.log("");
    console.log(`  ${bold("Google Cloud Remote Quotas & Reset Time (Enterprise):")}`);

    // Check if we have tier summaries (categories: Flash, Flash Lite, Pro)
    const tierSummaries = data.remoteModelQuotas.filter(
      (bucket: RemoteModelQuota) =>
        bucket.name && bucket.includedModels && bucket.includedModels.length > 0,
    );

    const itemsToDisplay = tierSummaries.length > 0 ? tierSummaries : data.remoteModelQuotas;

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
