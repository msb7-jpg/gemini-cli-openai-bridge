/**
 * @license
 * Copyright 2025 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */
import { sessionId, AuthType, type Config } from "@google/gemini-cli-core";
import { loadSettings, USER_SETTINGS_DIR } from "./config/settings.js";
import { loadExtensions } from "./config/extension.js";
import { getCliVersion } from "./utils/version.js";
import { loadServerConfig } from "./config/config.js";
import {
  registerOpenAIRoutes,
  registerAnthropicRoutes,
  registerResponsesApiRoutes,
} from "./bridge/index.js";
import { globalQuotaTracker } from "./services/quota-tracker.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { logger } from "./utils/logger.js";
import { type SecurityPolicy } from "./types.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import fs from "fs";
import path from "path";
import readline from "readline";
import { writePidFile, removePidFile } from "./utils/daemon.js";

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;

export async function createServer(config: Config, debugMode = false, cliVersion = "0.0.0") {
  const app = Fastify({
    bodyLimit: 50 * 1024 * 1024, // 50MB
    logger: false,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: true,
  });

  // Claude Code connection probe (ALL /api/hello)
  app.all("/api/hello", async (_req, reply) => {
    return reply.status(200).send("OK");
  });

  // Health check endpoint
  app.get("/health", async (_req, reply) => {
    return reply.status(200).send({ status: "ok", version: cliVersion });
  });

  // Quota & usage tracking endpoints
  const quotaHandler = async (
    _req: unknown,
    reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
  ) => {
    const snapshot = await globalQuotaTracker.getSnapshotAsync();
    return reply.status(200).send(snapshot);
  };

  app.get("/v1/quota", quotaHandler);
  app.get("/quota", quotaHandler);
  app.get("/v1/usage", quotaHandler);
  app.get("/usage", quotaHandler);

  // Register bridge routes
  await registerOpenAIRoutes(app, config, debugMode);
  await registerAnthropicRoutes(app, config, debugMode);
  await registerResponsesApiRoutes(app, config, debugMode);

  return app;
}

export async function startBridgeServer(): Promise<void> {
  const cliVersion = await getCliVersion();

  // --- Yargs-based argument parsing ---
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

  // --- Configuration variables from args and environment ---
  const host = argv.host;
  const debugMode = argv.debug;
  const useInternalPrompt = argv["use-internal-prompt"];
  const toolsModel = argv["tools-model"];
  const targetDir = path.resolve(argv["target-dir"]);

  // Priority: CLI arg > env var > default
  const port =
    argv.port ??
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

  logger.info("Starting Gemini CLI OpenAI Bridge...");
  if (useInternalPrompt) {
    logger.info("Internal prompt mode enabled (--use-internal-prompt). GEMINI.md will be loaded.");
  } else {
    logger.info(
      "Pure OpenAI bridge mode enabled. GEMINI.md will be ignored. Client system prompts will be used.",
    );
  }

  // Reuse core config loading, but manually construct Config.
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);
  const extensions = loadExtensions(workspaceRoot);

  // Determine the final security mode, with CLI args taking precedence over settings.
  const finalMode =
    (argv.mode as SecurityPolicy["mode"]) || settings.merged.securityPolicy?.mode || "read-only";

  const needsConfirmation = finalMode === "yolo" && !argv["i-know-what-i-am-doing"];

  // Display warnings and get confirmation if needed.
  await displaySecurityWarning(finalMode, targetDir);
  if (needsConfirmation) {
    await getInteractiveConfirmation();
  }

  let config;
  try {
    config = await loadServerConfig(
      settings.merged,
      extensions,
      sessionId,
      debugMode,
      useInternalPrompt,
      toolsModel,
      targetDir,
    );

    let selectedAuthType =
      settings.merged.selectedAuthType ||
      (
        settings.merged as Record<string, unknown> & {
          security?: { auth?: { selectedType?: AuthType } };
        }
      ).security?.auth?.selectedType;
    let authReason = "";

    if (selectedAuthType) {
      authReason = " (from .gemini/settings.json)";
    } else if (
      !process.env.GEMINI_API_KEY &&
      fs.existsSync(path.join(USER_SETTINGS_DIR, "oauth_creds.json"))
    ) {
      selectedAuthType = AuthType.LOGIN_WITH_GOOGLE;
      authReason = " (auto-detected from ~/.gemini/oauth_creds.json)";
    } else if (process.env.GEMINI_API_KEY) {
      selectedAuthType = AuthType.USE_GEMINI;
      authReason = " (fallback to GEMINI_API_KEY environment variable)";
    } else {
      logger.error(
        "Authentication missing: Please complete the authentication setup in gemini-cli first, or set the GEMINI_API_KEY environment variable.\n" +
          "This program accesses Gemini services via gemini-cli authentication.\n" +
          "Check the gemini-cli documentation for setup instructions.",
      );
      process.exit(1);
    }

    logger.info(`Attempting authentication using "${selectedAuthType}" method${authReason}...`);

    await config.initialize();
    await config.refreshAuth(selectedAuthType);
    logger.info(`✅ Authentication successful!`);
    logger.debug(debugMode, `Using authentication method: ${selectedAuthType}`);
    globalQuotaTracker.setAuthType(selectedAuthType);
  } catch (e) {
    logger.error(`❌ Authentication failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error(
      "Please check your authentication configuration (e.g., API Key validity, OAuth credentials) and try again.",
    );
    process.exit(1);
  }

  logger.debug(debugMode, `Using default model for tools: ${config.getModel()}`);

  const app = await createServer(config, debugMode, cliVersion);

  // Write PID file if running foreground standalone
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

async function displaySecurityWarning(mode: string, targetDir: string): Promise<void> {
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
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => rl.question("> ", resolve));
  rl.close();
  if (answer !== "YES") {
    console.log("Confirmation failed. Exiting.");
    process.exit(1);
  }
  console.log("Confirmation received. Starting server...");
}
