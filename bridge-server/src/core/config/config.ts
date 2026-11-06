/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  loadServerHierarchicalMemory,
  setGeminiMdFilename as setServerGeminiMdFilename,
  getCurrentGeminiMdFilename,
  ApprovalMode,
  GEMINI_CONFIG_DIR as GEMINI_DIR,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  FileDiscoveryService,
  type TelemetryTarget,
} from "@google/gemini-cli-core";
import { type Settings } from "./settings.js";
import { type Extension } from "./extension.js";
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadSandboxConfig } from "./sandboxConfig.js";

const configLogger = {
  debug: (...args: unknown[]) => console.debug("[DEBUG]", ...args),
};

async function loadHierarchicalGeminiMemory(
  currentWorkingDirectory: string,
  debugMode: boolean,
  fileService: FileDiscoveryService,
  extensionContextFilePaths: string[] = [],
): Promise<{ memoryContent: string; fileCount: number }> {
  if (debugMode) {
    configLogger.debug(
      `CLI: Delegating hierarchical memory load to server for CWD: ${currentWorkingDirectory}`,
    );
  }
  return loadServerHierarchicalMemory(
    currentWorkingDirectory,
    debugMode,
    fileService,
    extensionContextFilePaths,
  );
}

/**
 * Instantiates and configures the `@google/gemini-cli-core` `Config` instance for the server.
 * @param settings - Merged user and workspace settings.
 * @param extensions - Loaded Gemini CLI extensions.
 * @param sessionId - Unique session identifier.
 * @param debugMode - Whether debug logging is enabled.
 * @param loadInternalPrompt - Whether to load hierarchical GEMINI.md prompts.
 * @param toolsModel - Optional override model for tool execution.
 * @param targetDir - Root workspace directory for tool execution.
 * @returns Initialized `Config` object.
 */
export async function loadServerConfig(
  settings: Settings,
  extensions: Extension[],
  sessionId: string,
  debugMode: boolean,
  loadInternalPrompt: boolean,
  toolsModel?: string,
  targetDir?: string,
): Promise<Config> {
  loadEnvironment();

  if (settings.contextFileName) {
    setServerGeminiMdFilename(settings.contextFileName);
  } else {
    setServerGeminiMdFilename(getCurrentGeminiMdFilename());
  }

  const resolvedTargetDir = targetDir || process.cwd();
  const extensionContextFilePaths = extensions.flatMap((e) => e.contextFiles);
  const fileService = new FileDiscoveryService(resolvedTargetDir);

  let memoryContent = "";
  let fileCount = 0;

  if (loadInternalPrompt) {
    const memoryResult = await loadHierarchicalGeminiMemory(
      resolvedTargetDir,
      debugMode,
      fileService,
      extensionContextFilePaths,
    );
    memoryContent = memoryResult.memoryContent;
    fileCount = memoryResult.fileCount;
  }

  const sandboxConfig = await loadSandboxConfig(settings, {});

  const model =
    toolsModel ||
    process.env.GEMINI_TOOLS_DEFAULT_MODEL ||
    process.env.GEMINI_MODEL ||
    DEFAULT_GEMINI_FLASH_MODEL;

  return new Config({
    sessionId,
    embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
    sandbox: sandboxConfig,
    targetDir: resolvedTargetDir,
    debugMode,
    question: undefined,
    fullContext: false,
    coreTools: settings.coreTools || undefined,
    excludeTools: settings.excludeTools || undefined,
    toolDiscoveryCommand: settings.toolDiscoveryCommand,
    toolCallCommand: settings.toolCallCommand,
    userMemory: memoryContent,
    geminiMdFileCount: fileCount,
    approvalMode: ApprovalMode.YOLO,
    showMemoryUsage: settings.showMemoryUsage || false,
    accessibility: settings.accessibility,
    telemetry: {
      enabled: settings.telemetry?.enabled,
      target: settings.telemetry?.target as TelemetryTarget,
      otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? settings.telemetry?.otlpEndpoint,
      logPrompts: settings.telemetry?.logPrompts,
    },
    usageStatisticsEnabled: settings.usageStatisticsEnabled ?? true,
    fileFiltering: {
      respectGitIgnore: settings.fileFiltering?.respectGitIgnore,
      enableRecursiveFileSearch: settings.fileFiltering?.enableRecursiveFileSearch,
    },
    checkpointing: settings.checkpointing?.enabled,
    proxy:
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
    cwd: resolvedTargetDir,
    fileDiscoveryService: fileService,
    bugCommand: settings.bugCommand,
    model,
    extensionContextFilePaths,
  });
}

function findEnvFile(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  while (true) {
    const geminiEnvPath = path.join(currentDir, GEMINI_DIR, ".env");
    if (fs.existsSync(geminiEnvPath)) {
      return geminiEnvPath;
    }
    const envPath = path.join(currentDir, ".env");
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir || !parentDir) {
      const homeGeminiEnvPath = path.join(os.homedir(), GEMINI_DIR, ".env");
      if (fs.existsSync(homeGeminiEnvPath)) {
        return homeGeminiEnvPath;
      }
      const homeEnvPath = path.join(os.homedir(), ".env");
      if (fs.existsSync(homeEnvPath)) {
        return homeEnvPath;
      }
      return null;
    }
    currentDir = parentDir;
  }
}

function loadEnvironment(): void {
  const envFilePath = findEnvFile(process.cwd());
  if (envFilePath) {
    dotenv.config({ path: envFilePath, quiet: true });
  }
}
