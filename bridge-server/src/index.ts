#!/usr/bin/env node
/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from "url";
import {
  handleStatus,
  handleStop,
  startDaemon,
  removePidFile,
} from "./features/daemon-cli/process-manager.js";
import { handleQuota } from "./features/daemon-cli/quota-dashboard.view.js";
import { handleLogs } from "./features/daemon-cli/log-tailer.js";

const __filename = fileURLToPath(import.meta.url);

async function main() {
  const rawArgs = process.argv.slice(2);
  const firstArg = rawArgs[0];

  const resolvePort = () => {
    const portArg = rawArgs.find((arg) => arg.startsWith("--port=") || arg.startsWith("-p="));
    if (portArg) {
      return parseInt(portArg.split("=")[1], 10);
    }
    const portIndex =
      rawArgs.indexOf("--port") !== -1 ? rawArgs.indexOf("--port") : rawArgs.indexOf("-p");
    if (portIndex !== -1 && rawArgs[portIndex + 1]) {
      return parseInt(rawArgs[portIndex + 1], 10);
    }
    return (
      (process.env.GEMINI_BRIDGE_PORT ? parseInt(process.env.GEMINI_BRIDGE_PORT, 10) : undefined) ??
      (process.env.GEMINI_PORT ? parseInt(process.env.GEMINI_PORT, 10) : undefined) ??
      (process.env.GEMINI_MCP_PORT ? parseInt(process.env.GEMINI_MCP_PORT, 10) : undefined) ??
      8765
    );
  };

  const resolveHost = () => {
    const hostArg = rawArgs.find((arg) => arg.startsWith("--host=") || arg.startsWith("-h="));
    if (hostArg) {
      return hostArg.split("=")[1];
    }
    return "127.0.0.1";
  };

  if (firstArg === "status") {
    await handleStatus(resolvePort(), resolveHost());
    process.exit(0);
  }

  if (firstArg === "quota" || firstArg === "usage") {
    await handleQuota(resolvePort(), resolveHost());
    process.exit(0);
  }

  if (firstArg === "stop") {
    await handleStop(resolvePort(), resolveHost());
    process.exit(0);
  }

  if (firstArg === "restart") {
    await handleStop(resolvePort(), resolveHost());
    await startDaemon(resolvePort(), resolveHost(), rawArgs, __filename);
    process.exit(0);
  }

  if (firstArg === "logs") {
    const follow = rawArgs.includes("-f") || rawArgs.includes("--follow");
    handleLogs(follow);
    if (!follow) process.exit(0);
    return;
  }

  const isHelpOrVersion =
    firstArg === "help" ||
    rawArgs.includes("--help") ||
    rawArgs.includes("-?") ||
    rawArgs.includes("--version") ||
    rawArgs.includes("-v");

  const isForeground =
    isHelpOrVersion ||
    rawArgs.includes("--foreground") ||
    rawArgs.includes("-f") ||
    rawArgs.includes("--server-process");

  if (!isForeground) {
    await startDaemon(resolvePort(), resolveHost(), rawArgs, __filename);
    process.exit(0);
  }

  const { startBridgeServer } = await import("./features/daemon-cli/server-bootstrap.js");
  await startBridgeServer();
}

main().catch(async (error) => {
  console.error("Failed to run Gemini CLI Bridge:", error);
  removePidFile();
  process.exit(1);
});
