import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from './logger.js';

/**
 * In-memory LRU cache with fixed maximum capacity.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxSize: number;
  private onChange?: () => void;

  constructor(maxSize = 2000, onChange?: () => void) {
    super();
    this.maxSize = maxSize;
    this.onChange = onChange;
  }

  setOnChange(fn?: () => void): void {
    this.onChange = fn;
  }

  override get(key: K): V | undefined {
    if (!super.has(key)) {
      return undefined;
    }
    const value = super.get(key)!;
    // Refresh recency for true LRU eviction order
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
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

  override delete(key: K): boolean {
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

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.gemini');
const DEFAULT_CACHE_FILE = path.join(DEFAULT_CACHE_DIR, 'thought-signatures.json');

let customCacheFilePath: string | null = null;
let saveTimeout: NodeJS.Timeout | null = null;
let isDirty = false;
let isLoading = false;

export function getCacheFilePath(): string {
  return customCacheFilePath ?? DEFAULT_CACHE_FILE;
}

export function setCacheFilePathForTest(filePath: string | null): void {
  customCacheFilePath = filePath;
}

export function markDirtyAndScheduleSave(): void {
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
      logger.warn('Error during debounced thought signature cache flush:', err);
    }
  }, 1000);

  if (typeof saveTimeout.unref === 'function') {
    saveTimeout.unref();
  }
}

export const thoughtSignatureCache = new BoundedMap<string, string>(2000, markDirtyAndScheduleSave);
export const lastThoughtSignatureByTool = new BoundedMap<string, string>(500, markDirtyAndScheduleSave);
export const toolCallNameCache = new BoundedMap<string, string>(2000, markDirtyAndScheduleSave);

function populateMap(map: BoundedMap<string, string>, data: unknown): void {
  if (!data) return;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'string' && typeof item[1] === 'string') {
        map.set(item[0], item[1]);
      }
    }
  } else if (typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === 'string') {
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
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) {
      return;
    }
    const data = JSON.parse(content);
    isLoading = true;
    try {
      if (data && typeof data === 'object') {
        populateMap(thoughtSignatureCache, data.thoughtSignatureCache);
        populateMap(lastThoughtSignatureByTool, data.lastThoughtSignatureByTool);
        populateMap(toolCallNameCache, data.toolCallNameCache);
      }
    } finally {
      isLoading = false;
    }
  } catch (err) {
    logger.warn('Failed to load thought signature cache from disk:', err);
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
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
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
    logger.warn('Failed to save thought signature cache to disk:', err);
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

// Hook into process exit to flush any unwritten cache data
if (typeof process !== 'undefined' && typeof process.on === 'function') {
  process.on('beforeExit', () => {
    if (isDirty) {
      flushThoughtSignatureCache();
    }
  });
  process.on('exit', () => {
    if (isDirty) {
      flushThoughtSignatureCache();
    }
  });
}

// Automatically load on initialization
loadThoughtSignatureCacheFromDisk();
