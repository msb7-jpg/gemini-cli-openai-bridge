/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { TerminalSpinner, checkBridgeHealth, pollDaemonStartupHealth } from "./health-poller.js";
import { GEMINI_DIR, LOG_FILE, printStartupFailureLogs } from "./log-tailer.js";

const PID_FILE = path.join(GEMINI_DIR, "bridge.pid");

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

function ensureGeminiDir(): void {
  if (!fs.existsSync(GEMINI_DIR)) {
    fs.mkdirSync(GEMINI_DIR, { recursive: true });
  }
}

/**
 * Checks whether a process with the given PID is alive on the OS.
 * @param pid - Process ID to check.
 * @returns `true` if the process is running, `false` otherwise.
 */
export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and parses the daemon PID file if present and valid.
 * @param customPidPath - Optional custom path for testing.
 * @returns Parsed `PidInfo` or `null` if missing/corrupted.
 */
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

/**
 * Writes daemon PID metadata to disk.
 * @param info - PID, port, host, and start timestamp metadata.
 * @param customPidPath - Optional custom path for testing.
 */
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

/**
 * Deletes the daemon PID file if it exists.
 * @param customPidPath - Optional custom path for testing.
 */
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

/**
 * Formats an elapsed uptime duration from a start timestamp into a human-readable string.
 * @param startTime - Epoch timestamp in milliseconds.
 * @returns Formatted duration string (e.g. `45s`, `2m 15s`, `3h 40m`).
 */
export function formatUptime(startTime: number): string {
  const diffSec = Math.floor((Date.now() - startTime) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s`;
  const diffHours = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  return `${diffHours}h ${remMin}m`;
}

function printEndpointsList(host: string, port: number, includeQuota = false): void {
  console.log(`  ${cyan("OpenAI:")}    http://${host}:${port}/v1/chat/completions`);
  console.log(`  ${cyan("Anthropic:")} http://${host}:${port}/v1/messages`);
  console.log(`  ${cyan("Models:")}    http://${host}:${port}/v1/models`);
  if (includeQuota) {
    console.log(`  ${cyan("Quota:")}     http://${host}:${port}/v1/quota`);
  }
  console.log(`  ${cyan("Logs:")}      ${LOG_FILE}`);
}

/**
 * Prints the current operational status of the background daemon.
 * @param port - Fallback port number if no PID file is found.
 * @param host - Fallback host address if no PID file is found.
 */
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
    printEndpointsList(effectiveHost, effectivePort);
    console.log("");
    console.log(
      dim(
        `Commands: 'gemini-bridge quota' | 'gemini-bridge stop' | 'gemini-bridge restart' | 'gemini-bridge logs'`,
      ),
    );
  } else if (health.ok) {
    console.log(
      yellow(
        `${bold("● Gemini Bridge")} is responding on port ${effectivePort}, but without a recent PID record.`,
      ),
    );
    console.log(
      `  ${cyan("OpenAI:")}    http://${effectiveHost}:${effectivePort}/v1/chat/completions`,
    );
  } else {
    if (pidInfo && !isPidRunning(pidInfo.pid)) {
      removePidFile();
    }
    console.log(red(`${bold("○ Gemini Bridge")} is ${bold("INACTIVE")}`));
    console.log(
      dim(`To start in background run: ${bold("gemini-bridge")} or ${bold("gemini-bridge start")}`),
    );
  }
}

async function terminateProcessGracefully(pid: number, waitIterations = 15): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  let exited = false;
  for (let i = 0; i < waitIterations; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!isPidRunning(pid)) {
      exited = true;
      break;
    }
  }

  if (!exited && isPidRunning(pid)) {
    console.log(yellow(`Force killing (SIGKILL) PID ${pid}...`));
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

/**
 * Stops the running background daemon gracefully with `SIGTERM` and escalates to `SIGKILL` if needed.
 * @param port - Target port number.
 * @param host - Target host address.
 */
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
  await terminateProcessGracefully(pid, 15);

  removePidFile();
  console.log(green(`✓ Gemini Bridge stopped successfully.`));
}

/**
 * Spawns the bridge server as a detached background daemon and polls until healthy.
 * @param port - TCP port to bind.
 * @param host - Host interface to bind.
 * @param extraArgs - Additional CLI arguments forwarded to the child process.
 * @param scriptPath - Entry script path to execute.
 */
export async function startDaemon(
  port: number,
  host: string,
  extraArgs: string[],
  scriptPath: string,
): Promise<void> {
  ensureGeminiDir();

  const pidInfo = readPidFile();
  if (pidInfo && isPidRunning(pidInfo.pid)) {
    const health = await checkBridgeHealth(pidInfo.port, pidInfo.host, 1000);
    if (health.ok) {
      console.log(green(`${bold("● Gemini Bridge")} is already running!`));
      console.log(`  ${cyan("PID:")}       ${pidInfo.pid}`);
      console.log(`  ${cyan("Port:")}      ${pidInfo.port}`);
      console.log(`  ${cyan("Uptime:")}    ${formatUptime(pidInfo.startTime)}`);
      printEndpointsList(pidInfo.host, pidInfo.port);
      return;
    }
  }

  const currentHealth = await checkBridgeHealth(port, host, 800);
  if (currentHealth.ok) {
    console.log(
      green(`${bold("● Gemini Bridge")} is already active and responding on port ${port}.`),
    );
    return;
  }

  const logStartOffset = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;
  const logFd = fs.openSync(LOG_FILE, "a");

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

  const timeoutSec = Math.max(10, Number(process.env.GEMINI_BRIDGE_STARTUP_TIMEOUT) || 45);
  const { online, version } = await pollDaemonStartupHealth(
    childPid,
    port,
    host,
    timeoutSec,
    spinner,
    isPidRunning,
  );

  spinner.stop(true);

  if (online) {
    console.log(green(`${bold("✓ Gemini Bridge started successfully (detached)!")}`));
    console.log(`  ${cyan("PID:")}       ${childPid}`);
    console.log(`  ${cyan("Port:")}      ${port}`);
    if (version) {
      console.log(`  ${cyan("Version:")}   ${version}`);
    }
    printEndpointsList(host, port, true);
    console.log("");
    console.log(dim(`Useful commands:`));
    console.log(dim(`  gemini-bridge status   (check status)`));
    console.log(dim(`  gemini-bridge quota    (check usage and quota)`));
    console.log(dim(`  gemini-bridge stop     (stop server)`));
    console.log(dim(`  gemini-bridge restart  (restart server)`));
    console.log(dim(`  gemini-bridge logs     (view logs)`));
    return;
  }

  if (!isPidRunning(childPid)) {
    console.error(red("❌ The bridge server process exited unexpectedly during startup."));
  } else {
    console.error(red(`❌ The bridge server did not respond within ${timeoutSec} seconds.`));
    await terminateProcessGracefully(childPid, 5);
  }

  removePidFile();
  printStartupFailureLogs(logStartOffset);
  process.exit(1);
}
