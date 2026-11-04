#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  sessionId,
  AuthType,
} from '@google/gemini-cli-core';
import { loadSettings } from './config/settings.js';
import { loadExtensions } from './config/extension.js';
import { getCliVersion } from './utils/version.js';
import { loadServerConfig } from './config/config.js';
import { createOpenAIRouter, createAnthropicRouter } from './bridge/index.js';
import express from 'express';
import { logger } from './utils/logger.js';
import { type SecurityPolicy } from './types.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import {
  handleStatus,
  handleStop,
  handleLogs,
  startDaemon,
  removePidFile,
  writePidFile,
} from './utils/daemon.js';

const __filename = fileURLToPath(import.meta.url);

async function main() {
  const rawArgs = hideBin(process.argv);
  const firstArg = rawArgs[0];

  // Helper to resolve port before deep parsing
  const resolvePort = () => {
    const portArg = rawArgs.find(a => a.startsWith('--port=') || a.startsWith('-p='));
    if (portArg) {
      return parseInt(portArg.split('=')[1], 10);
    }
    const pIdx = rawArgs.indexOf('--port') !== -1 ? rawArgs.indexOf('--port') : rawArgs.indexOf('-p');
    if (pIdx !== -1 && rawArgs[pIdx + 1]) {
      return parseInt(rawArgs[pIdx + 1], 10);
    }
    return (
      (process.env.GEMINI_BRIDGE_PORT ? parseInt(process.env.GEMINI_BRIDGE_PORT, 10) : undefined) ??
      (process.env.GEMINI_PORT ? parseInt(process.env.GEMINI_PORT, 10) : undefined) ??
      (process.env.GEMINI_MCP_PORT ? parseInt(process.env.GEMINI_MCP_PORT, 10) : undefined) ??
      8765
    );
  };

  const resolveHost = () => {
    const hostArg = rawArgs.find(a => a.startsWith('--host=') || a.startsWith('-h='));
    if (hostArg) {
      return hostArg.split('=')[1];
    }
    return '127.0.0.1';
  };

  // Subcommand dispatch
  if (firstArg === 'status') {
    await handleStatus(resolvePort(), resolveHost());
    process.exit(0);
  }

  if (firstArg === 'stop') {
    await handleStop(resolvePort(), resolveHost());
    process.exit(0);
  }

  if (firstArg === 'restart') {
    await handleStop(resolvePort(), resolveHost());
    await startDaemon(resolvePort(), resolveHost(), rawArgs, __filename);
    process.exit(0);
  }

  if (firstArg === 'logs') {
    const follow = rawArgs.includes('-f') || rawArgs.includes('--follow');
    handleLogs(follow);
    if (!follow) process.exit(0);
    return;
  }

  const isForeground =
    rawArgs.includes('--foreground') ||
    rawArgs.includes('-f') ||
    rawArgs.includes('--server-process');

  // If invoked with no subcommand or 'start', default to detach daemon unless --foreground is specified
  if (!isForeground) {
    await startDaemon(resolvePort(), resolveHost(), rawArgs, __filename);
    process.exit(0);
  }

  // Otherwise, run the actual HTTP server process in this process
  await startBridgeServer();
}

async function startBridgeServer() {
  // --- Yargs-based argument parsing ---
  const argv = await yargs(hideBin(process.argv))
    .command('start', 'Start the bridge server in foreground')
    .command('status', 'Show status of the bridge daemon')
    .command('stop', 'Stop the bridge daemon')
    .command('restart', 'Restart the bridge daemon')
    .command('logs', 'View server logs')
    .option('host', {
      alias: 'h',
      type: 'string',
      description: 'The host address to listen on.',
      default: '127.0.0.1',
    })
    .option('port', {
      alias: 'p',
      type: 'number',
      description:
        'The port to listen on. Can also be set via GEMINI_BRIDGE_PORT (or GEMINI_MCP_PORT).',
    })
    .option('target-dir', {
      alias: 'd',
      type: 'string',
      description:
        'The absolute path to the root directory for all operations. Defaults to the current working directory.',
      default: process.cwd(),
    })
    .option('debug', {
      type: 'boolean',
      description: 'Enable detailed debug logging.',
      default: false,
    })
    .option('use-internal-prompt', {
      type: 'boolean',
      description:
        'Load internal GEMINI.md prompts. If false, server runs in pure OpenAI bridge mode and uses client system prompts.',
      default: false,
    })
    .option('tools-model', {
      type: 'string',
      description:
        'Specify a default model for tool execution (e.g., web search). Can also be set via GEMINI_TOOLS_DEFAULT_MODEL.',
    })
    .option('mode', {
      type: 'string',
      description: "Set the server's security mode.",
      choices: ['read-only', 'edit', 'configured', 'yolo'],
    })
    .option('i-know-what-i-am-doing', {
      type: 'boolean',
      description:
        "Bypass interactive safety confirmations for 'yolo' mode.",
      default: false,
    })
    .option('foreground', {
      type: 'boolean',
      description: 'Run server in the foreground.',
      default: false,
    })
    .option('server-process', {
      type: 'boolean',
      hidden: true,
      default: false,
    })
    .help()
    .alias('help', '?').argv;

  // --- Configuration variables from args and environment ---
  const host = argv.host;
  const debugMode = argv.debug;
  const useInternalPrompt = argv['use-internal-prompt'];
  const toolsModel = argv['tools-model'];
  const targetDir = path.resolve(argv['target-dir']);

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
      'Invalid port number provided. Use --port=<number> or set GEMINI_BRIDGE_PORT environment variable.',
    );
    process.exit(1);
  }

  logger.info('Starting Gemini CLI OpenAI Bridge...');
  if (useInternalPrompt) {
    logger.info(
      'Internal prompt mode enabled (--use-internal-prompt). GEMINI.md will be loaded.',
    );
  } else {
    logger.info(
      'Pure OpenAI bridge mode enabled. GEMINI.md will be ignored. Client system prompts will be used.',
    );
  }

  // Reuse core config loading, but manually construct Config.
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);
  const extensions = loadExtensions(workspaceRoot);
  const cliVersion = await getCliVersion();

  // Determine the final security mode, with CLI args taking precedence over settings.
  const finalMode =
    (argv.mode as SecurityPolicy['mode']) ||
    settings.merged.securityPolicy?.mode ||
    'read-only';

  const needsConfirmation =
    finalMode === 'yolo' && !argv['i-know-what-i-am-doing'];

  // Display warnings and get confirmation if needed.
  await displaySecurityWarning(finalMode, targetDir);
  if (needsConfirmation) {
    await getInteractiveConfirmation();
  }

  const config = await loadServerConfig(
    settings.merged,
    extensions,
    sessionId,
    debugMode,
    useInternalPrompt,
    toolsModel,
    targetDir,
  );

  let selectedAuthType = settings.merged.selectedAuthType;
  let authReason = '';

  if (selectedAuthType) {
    authReason = ' (from .gemini/settings.json)';
  } else if (process.env.GEMINI_API_KEY) {
    selectedAuthType = AuthType.USE_GEMINI;
    authReason = ' (fallback to GEMINI_API_KEY environment variable)';
  } else {
    logger.error(
      'Authentication missing: Please complete the authentication setup in gemini-cli first, or set the GEMINI_API_KEY environment variable.\n' +
        'This program accesses Gemini services via gemini-cli authentication.\n' +
        'Check the gemini-cli documentation for setup instructions.',
    );
    process.exit(1);
  }

  logger.info(
    `Attempting authentication using "${selectedAuthType}" method${authReason}...`,
  );

  try {
    await config.initialize();
    await config.refreshAuth(selectedAuthType);
    logger.info(`✅ Authentication successful!`);
    logger.debug(debugMode, `Using authentication method: ${selectedAuthType}`);
  } catch (e) {
    logger.error(
      `❌ Authentication failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    logger.error(
      'Please check your authentication configuration (e.g., API Key validity, OAuth credentials) and try again.',
    );
    process.exit(1);
  }

  logger.debug(debugMode, `Using default model for tools: ${config.getModel()}`);

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Claude Code connection probe
  app.all('/api/hello', (_req, res) => {
    res.status(200).send('OK');
  });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: cliVersion });
  });

  // Mount OpenAI compatible endpoint (/v1/chat/completions)
  const openAIRouter = createOpenAIRouter(config, debugMode);
  app.use('/v1', openAIRouter);

  // Mount Anthropic Messages compatible endpoint (/v1/messages, /v1/models for Claude Code)
  const anthropicRouter = createAnthropicRouter(config, debugMode);
  app.use('/v1', anthropicRouter);
  app.use('/', anthropicRouter);

  // Write PID file if running foreground standalone
  writePidFile({
    pid: process.pid,
    port,
    host,
    startTime: Date.now(),
  });

  const cleanup = () => {
    removePidFile();
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  app.listen(port, host, () => {
    logger.info(`Gemini CLI Bridge running:`, {
      host,
      port,
      openAI: `http://${host}:${port}/v1/chat/completions`,
      anthropic: `http://${host}:${port}/v1/messages`,
      models: `http://${host}:${port}/v1/models`,
    });
  });
}

main().catch(error => {
  logger.error('Failed to start Gemini CLI OpenAI Bridge:', error);
  removePidFile();
  process.exit(1);
});

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;

async function displaySecurityWarning(
  mode: string,
  targetDir: string,
): Promise<void> {
  console.log('--- Security Mode Initialized ---');
  switch (mode) {
    case 'read-only':
      console.log(green(`${bold('Mode: Read-Only')} (Default & Safest)`));
      console.log(green(`✓ Read-only operations enabled.`));
      console.log(green(`✓ Operations restricted to: ${targetDir}`));
      break;
    case 'edit':
      console.log(yellow(`${bold('Mode: Edit')}`));
      console.log(
        yellow(`⚠ Write permissions to files within: ${targetDir}`),
      );
      break;
    case 'configured':
      console.log(yellow(`${bold('Mode: Configured')}`));
      console.log(
        yellow(
          `⚠ Security is managed by your 'securityPolicy' settings in settings.json.`,
        ),
      );
      break;
    case 'yolo':
      console.log(red(`${bold('███ MODE: YOLO - EXTREMELY DANGEROUS ███')}`));
      console.log(
        red(
          `⚠ Unrestricted mode enabled.`,
        ),
      );
      break;
  }
  console.log('---------------------------------');
}

async function getInteractiveConfirmation(): Promise<void> {
  console.log(
    red(`${bold('ACTION REQUIRED:')} You have enabled a high-risk mode.`),
  );
  console.log(
    `To confirm you understand the risks, please type ${bold('YES')} and press Enter.`,
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>(resolve => rl.question('> ', resolve));
  rl.close();
  if (answer !== 'YES') {
    console.log('Confirmation failed. Exiting.');
    process.exit(1);
  }
  console.log('Confirmation received. Starting server...');
}
