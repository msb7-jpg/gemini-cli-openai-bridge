/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { sessionId, AuthType, type Config } from "@google/gemini-cli-core";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  loadSettings,
  USER_SETTINGS_DIR,
  type SecurityPolicy,
  type Settings,
} from "../../core/config/settings.js";
import { loadExtensions, type Extension } from "../../core/config/extension.js";
import { loadServerConfig } from "../../core/config/config.js";
import { getCliVersion } from "../../shared/version.js";
import { logger } from "../../shared/logger.js";
import { globalQuotaTracker } from "../models-and-quota/quota-tracker.service.js";
import { writePidFile, removePidFile } from "./process-manager.js";
import { createServer } from "../../server.js";

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;

interface BridgeCliArguments {
  host: string;
  port?: number;
  "target-dir": string;
  debug: boolean;
  "use-internal-prompt": boolean;
  "tools-model"?: string;
  mode?: string;
  "i-know-what-i-am-doing": boolean;
}

async function parseCliArguments(cliVersion: string): Promise<BridgeCliArguments> {
  const argv = await yargs(hideBin(process.argv))
    .version(cliVersion)
    .alias("version", "v")
    .command("start", "Start the bridge server in foreground")
    .command("status", "Show status of the bridge daemon")
    .command("quota", "Show quota and token usage of the bridge")
    .command("stop", "Stop the bridge daemon")
    .command("restart", "Restart the bridge daemon")
    .command("logs", "View server logs")
    .option("host", {
      alias: "h",
      type: "string",
      description: "The host address to listen on.",
      default: "127.0.0.1",
    })
    .option("port", {
      alias: "p",
      type: "number",
      description:
        "The port to listen on. Can also be set via GEMINI_BRIDGE_PORT (or GEMINI_MCP_PORT).",
    })
    .option("target-dir", {
      alias: "d",
      type: "string",
      description:
        "The absolute path to the root directory for all operations. Defaults to the current working directory.",
      default: process.cwd(),
    })
    .option("debug", {
      type: "boolean",
      description: "Enable detailed debug logging.",
      default: false,
    })
    .option("use-internal-prompt", {
      type: "boolean",
      description:
        "Load internal GEMINI.md prompts. If false, server runs in pure OpenAI bridge mode and uses client system prompts.",
      default: false,
    })
    .option("tools-model", {
      type: "string",
      description:
        "Specify a default model for tool execution (e.g., web search). Can also be set via GEMINI_TOOLS_DEFAULT_MODEL.",
    })
    .option("mode", {
      type: "string",
      description: "Set the server's security mode.",
      choices: ["read-only", "edit", "configured", "yolo"],
    })
    .option("i-know-what-i-am-doing", {
      type: "boolean",
      description: "Bypass interactive safety confirmations for 'yolo' mode.",
      default: false,
    })
    .option("foreground", {
      type: "boolean",
      description: "Run server in the foreground.",
      default: false,
    })
    .option("server-process", {
      type: "boolean",
      hidden: true,
      default: false,
    })
    .help()
    .alias("help", "?").argv;

  return argv as unknown as BridgeCliArguments;
}

function resolveListenPort(cliPort?: number): number {
  const port =
    cliPort ??
    (process.env.GEMINI_BRIDGE_PORT
      ? parseInt(process.env.GEMINI_BRIDGE_PORT, 10)
      : process.env.GEMINI_PORT
        ? parseInt(process.env.GEMINI_PORT, 10)
        : process.env.GEMINI_MCP_PORT
          ? parseInt(process.env.GEMINI_MCP_PORT, 10)
          : 8765);

  if (isNaN(port)) {
    logger.error(
      "Invalid port number provided. Use --port=<number> or set GEMINI_BRIDGE_PORT environment variable.",
    );
    process.exit(1);
  }
  return port;
}

function resolveSelectedAuthType(mergedSettings: Settings): {
  selectedAuthType: AuthType;
  authReason: string;
} {
  const nestedAuthType = (
    mergedSettings as Record<string, unknown> & {
      security?: { auth?: { selectedType?: AuthType } };
    }
  ).security?.auth?.selectedType;

  const configuredAuth = mergedSettings.selectedAuthType || nestedAuthType;
  if (configuredAuth) {
    return { selectedAuthType: configuredAuth, authReason: " (from .gemini/settings.json)" };
  }

  if (
    !process.env.GEMINI_API_KEY &&
    fs.existsSync(path.join(USER_SETTINGS_DIR, "oauth_creds.json"))
  ) {
    return {
      selectedAuthType: AuthType.LOGIN_WITH_GOOGLE,
      authReason: " (auto-detected from ~/.gemini/oauth_creds.json)",
    };
  }

  if (process.env.GEMINI_API_KEY) {
    return {
      selectedAuthType: AuthType.USE_GEMINI,
      authReason: " (fallback to GEMINI_API_KEY environment variable)",
    };
  }

  logger.error(
    "Authentication missing: Please complete the authentication setup in gemini-cli first, or set the GEMINI_API_KEY environment variable.\n" +
      "This program accesses Gemini services via gemini-cli authentication.\n" +
      "Check the gemini-cli documentation for setup instructions.",
  );
  process.exit(1);
}

async function initializeAuthenticatedConfig(
  mergedSettings: Settings,
  extensions: Extension[],
  debugMode: boolean,
  useInternalPrompt: boolean,
  toolsModel: string | undefined,
  targetDir: string,
): Promise<Config> {
  try {
    const config = await loadServerConfig(
      mergedSettings,
      extensions,
      sessionId,
      debugMode,
      useInternalPrompt,
      toolsModel,
      targetDir,
    );

    const { selectedAuthType, authReason } = resolveSelectedAuthType(mergedSettings);
    logger.info(`Attempting authentication using "${selectedAuthType}" method${authReason}...`);

    await config.initialize();
    await config.refreshAuth(selectedAuthType);
    logger.info(`✅ Authentication successful!`);
    logger.debug(debugMode, `Using authentication method: ${selectedAuthType}`);
    globalQuotaTracker.setAuthType(selectedAuthType);

    return config;
  } catch (e) {
    logger.error(`❌ Authentication failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error(
      "Please check your authentication configuration (e.g., API Key validity, OAuth credentials) and try again.",
    );
    process.exit(1);
  }
}

function displaySecurityWarning(mode: string, targetDir: string): void {
  console.log("--- Security Mode Initialized ---");
  switch (mode) {
    case "read-only":
      console.log(green(`${bold("Mode: Read-Only")} (Default & Safest)`));
      console.log(green(`✓ Read-only operations enabled.`));
      console.log(green(`✓ Operations restricted to: ${targetDir}`));
      break;
    case "edit":
      console.log(yellow(`${bold("Mode: Edit")}`));
      console.log(yellow(`⚠ Write permissions to files within: ${targetDir}`));
      break;
    case "configured":
      console.log(yellow(`${bold("Mode: Configured")}`));
      console.log(
        yellow(`⚠ Security is managed by your 'securityPolicy' settings in settings.json.`),
      );
      break;
    case "yolo":
      console.log(red(`${bold("███ MODE: YOLO - EXTREMELY DANGEROUS ███")}`));
      console.log(red(`⚠ Unrestricted mode enabled.`));
      break;
  }
  console.log("---------------------------------");
}

async function getInteractiveConfirmation(): Promise<void> {
  console.log(red(`${bold("ACTION REQUIRED:")} You have enabled a high-risk mode.`));
  console.log(`To confirm you understand the risks, please type ${bold("YES")} and press Enter.`);
  const rlInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => rlInterface.question("> ", resolve));
  rlInterface.close();
  if (answer !== "YES") {
    console.log("Confirmation failed. Exiting.");
    process.exit(1);
  }
  console.log("Confirmation received. Starting server...");
}

/**
 * Bootstraps the standalone foreground Fastify bridge server from CLI arguments and `.gemini/settings.json`.
 */
export async function startBridgeServer(): Promise<void> {
  const cliVersion = await getCliVersion();
  const argv = await parseCliArguments(cliVersion);

  const host = argv.host;
  const debugMode = argv.debug;
  const useInternalPrompt = argv["use-internal-prompt"];
  const toolsModel = argv["tools-model"];
  const targetDir = path.resolve(argv["target-dir"]);
  const port = resolveListenPort(argv.port);

  logger.info("Starting Gemini CLI OpenAI Bridge...");
  if (useInternalPrompt) {
    logger.info("Internal prompt mode enabled (--use-internal-prompt). GEMINI.md will be loaded.");
  } else {
    logger.info(
      "Pure OpenAI bridge mode enabled. GEMINI.md will be ignored. Client system prompts will be used.",
    );
  }

  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);
  const extensions = loadExtensions(workspaceRoot);

  const finalMode =
    (argv.mode as SecurityPolicy["mode"]) || settings.merged.securityPolicy?.mode || "read-only";
  const needsConfirmation = finalMode === "yolo" && !argv["i-know-what-i-am-doing"];

  displaySecurityWarning(finalMode, targetDir);
  if (needsConfirmation) {
    await getInteractiveConfirmation();
  }

  const config = await initializeAuthenticatedConfig(
    settings.merged,
    extensions,
    debugMode,
    useInternalPrompt,
    toolsModel,
    targetDir,
  );

  logger.debug(debugMode, `Using default model for tools: ${config.getModel()}`);

  const app = await createServer(config, debugMode, cliVersion);

  writePidFile({
    pid: process.pid,
    port,
    host,
    startTime: Date.now(),
  });

  const cleanup = async () => {
    try {
      await app.close();
    } catch {
      // Ignore closing errors on exit
    }
    removePidFile();
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  try {
    await app.listen({ port, host });
    logger.info(`Gemini CLI Bridge running:`, {
      host,
      port,
      openAI: `http://${host}:${port}/v1/chat/completions`,
      anthropic: `http://${host}:${port}/v1/messages`,
      models: `http://${host}:${port}/v1/models`,
      quota: `http://${host}:${port}/v1/quota`,
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    removePidFile();
    process.exit(1);
  }
}
