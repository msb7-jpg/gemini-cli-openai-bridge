/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../../shared/logger.js";

/**
 * In-memory LRU cache with fixed maximum capacity.
 */
export class BoundedMap<Key, Value> extends Map<Key, Value> {
  private readonly maxSize: number;
  private onChange?: () => void;

  constructor(maxSize = 2000, onChange?: () => void) {
    super();
    this.maxSize = maxSize;
    this.onChange = onChange;
  }

  override get(key: Key): Value | undefined {
    if (!super.has(key)) {
      return undefined;
    }
    const value = super.get(key)!;
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: Key, value: Value): this {
    if (this.has(key)) {
      super.delete(key);
    } else if (this.size >= this.maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey !== undefined) {
        super.delete(firstKey);
      }
    }
    super.set(key, value);
    this.onChange?.();
    return this;
  }

  override delete(key: Key): boolean {
    const res = super.delete(key);
    if (res) {
      this.onChange?.();
    }
    return res;
  }

  override clear(): void {
    const hadItems = this.size > 0;
    super.clear();
    if (hadItems) {
      this.onChange?.();
    }
  }
}

const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".gemini");
const DEFAULT_CACHE_FILE = path.join(DEFAULT_CACHE_DIR, "thought-signatures.json");

let customCacheFilePath: string | null = null;
let saveTimeout: NodeJS.Timeout | null = null;
let isDirty = false;
let isLoading = false;

/**
 * Returns the active file path used for persisting thought signatures on disk.
 * @returns The absolute path to the thought signature cache JSON file.
 */
export function getCacheFilePath(): string {
  return customCacheFilePath ?? DEFAULT_CACHE_FILE;
}

/**
 * Overrides the disk cache file path for isolated testing.
 * @param filePath - Custom path or `null` to restore the default path.
 */
export function setCacheFilePathForTest(filePath: string | null): void {
  customCacheFilePath = filePath;
}

function markDirtyAndScheduleSave(): void {
  if (isLoading) {
    return;
  }
  isDirty = true;
  if (saveTimeout !== null) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      flushThoughtSignatureCache();
    } catch (err) {
      logger.warn("Error during debounced thought signature cache flush:", err);
    }
  }, 1000);

  if (typeof saveTimeout.unref === "function") {
    saveTimeout.unref();
  }
}

export const thoughtSignatureCache = new BoundedMap<string, string>(2000, markDirtyAndScheduleSave);
export const lastThoughtSignatureByTool = new BoundedMap<string, string>(
  500,
  markDirtyAndScheduleSave,
);
export const toolCallNameCache = new BoundedMap<string, string>(2000, markDirtyAndScheduleSave);

/**
 * Records a tool call's name and optional Gemini thought signature in the LRU caches.
 * @param toolCallId - Generated or upstream tool call identifier.
 * @param toolName - Name of the invoked tool/function.
 * @param thoughtSignature - Optional cryptographic thought signature from Gemini.
 */
export function recordToolCallSignature(
  toolCallId: string,
  toolName: string,
  thoughtSignature?: string,
): void {
  toolCallNameCache.set(toolCallId, toolName);
  if (thoughtSignature) {
    thoughtSignatureCache.set(toolCallId, thoughtSignature);
    lastThoughtSignatureByTool.set(toolName, thoughtSignature);
  }
}

/**
 * Looks up a cached thought signature for a tool call ID or falls back to the tool name's latest signature.
 * @param toolCallId - Tool call identifier.
 * @param toolName - Function name associated with the tool call.
 * @returns The cached thought signature string if found, or `undefined`.
 */
export function resolveToolCallSignature(toolCallId: string, toolName: string): string | undefined {
  return thoughtSignatureCache.get(toolCallId) || lastThoughtSignatureByTool.get(toolName);
}

function populateMap(map: BoundedMap<string, string>, data: unknown): void {
  if (!data) return;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (
        Array.isArray(item) &&
        item.length >= 2 &&
        typeof item[0] === "string" &&
        typeof item[1] === "string"
      ) {
        map.set(item[0], item[1]);
      }
    }
  } else if (typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === "string") {
        map.set(key, value);
      }
    }
  }
}

/**
 * Loads cache contents from disk if the file exists.
 * Gracefully handles missing files, empty files, or corrupted JSON.
 */
export function loadThoughtSignatureCacheFromDisk(): void {
  const filePath = getCacheFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.trim()) {
      return;
    }
    const data = JSON.parse(content) as Record<string, unknown>;
    isLoading = true;
    try {
      if (data && typeof data === "object") {
        populateMap(thoughtSignatureCache, data.thoughtSignatureCache);
        populateMap(lastThoughtSignatureByTool, data.lastThoughtSignatureByTool);
        populateMap(toolCallNameCache, data.toolCallNameCache);
      }
    } finally {
      isLoading = false;
    }
  } catch (err) {
    logger.warn("Failed to load thought signature cache from disk:", err);
  }
}

/**
 * Immediately flushes pending in-memory cache to disk via atomic write.
 */
export function flushThoughtSignatureCache(): void {
  if (saveTimeout !== null) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }

  const filePath = getCacheFilePath();
  const dir = path.dirname(filePath);
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      version: 1,
      thoughtSignatureCache: Object.fromEntries(thoughtSignatureCache.entries()),
      lastThoughtSignatureByTool: Object.fromEntries(lastThoughtSignatureByTool.entries()),
      toolCallNameCache: Object.fromEntries(toolCallNameCache.entries()),
    };
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
    isDirty = false;
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup error
    }
    logger.warn("Failed to save thought signature cache to disk:", err);
  }
}

/**
 * Resets cache entries and internal states (primarily for testing).
 */
export function clearThoughtSignatureCache(): void {
  isLoading = true;
  try {
    thoughtSignatureCache.clear();
    lastThoughtSignatureByTool.clear();
    toolCallNameCache.clear();
  } finally {
    isLoading = false;
  }
  isDirty = false;
  if (saveTimeout !== null) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
}

if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("beforeExit", () => {
    if (isDirty) {
      flushThoughtSignatureCache();
    }
  });
  process.on("exit", () => {
    if (isDirty) {
      flushThoughtSignatureCache();
    }
  });
}

loadThoughtSignatureCacheFromDisk();
