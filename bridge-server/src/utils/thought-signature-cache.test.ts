import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  BoundedMap,
  thoughtSignatureCache,
  lastThoughtSignatureByTool,
  toolCallNameCache,
  flushThoughtSignatureCache,
  loadThoughtSignatureCacheFromDisk,
  setCacheFilePathForTest,
  clearThoughtSignatureCache,
  getCacheFilePath,
} from './thought-signature-cache.js';

describe('thought-signature-cache', () => {
  let tempDir: string;
  let testCacheFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thought-sig-test-'));
    testCacheFile = path.join(tempDir, 'subfolder', 'thought-signatures.json');
    setCacheFilePathForTest(testCacheFile);
    clearThoughtSignatureCache();
  });

  afterEach(() => {
    clearThoughtSignatureCache();
    setCacheFilePathForTest(null);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    vi.useRealTimers();
  });

  describe('BoundedMap', () => {
    it('stores and retrieves keys up to maxSize', () => {
      const map = new BoundedMap<string, string>(3);
      map.set('a', '1');
      map.set('b', '2');
      map.set('c', '3');

      expect(map.size).toBe(3);
      expect(map.get('a')).toBe('1');
      expect(map.get('b')).toBe('2');
      expect(map.get('c')).toBe('3');
    });

    it('evicts the oldest key when maxSize is exceeded', () => {
      const map = new BoundedMap<string, string>(2);
      map.set('a', '1');
      map.set('b', '2');
      map.set('c', '3');

      expect(map.size).toBe(2);
      expect(map.get('a')).toBeUndefined();
      expect(map.get('b')).toBe('2');
      expect(map.get('c')).toBe('3');
    });

    it('refreshes recency on get() following LRU policy', () => {
      const map = new BoundedMap<string, string>(2);
      map.set('a', '1');
      map.set('b', '2');

      // Access 'a' so 'b' becomes the least recently used
      expect(map.get('a')).toBe('1');

      // Adding 'c' should evict 'b', not 'a'
      map.set('c', '3');
      expect(map.size).toBe(2);
      expect(map.get('a')).toBe('1');
      expect(map.get('b')).toBeUndefined();
      expect(map.get('c')).toBe('3');
    });

    it('refreshes recency on update set() following LRU policy', () => {
      const map = new BoundedMap<string, string>(2);
      map.set('a', '1');
      map.set('b', '2');

      // Update 'a'
      map.set('a', '1-updated');

      // Adding 'c' should evict 'b'
      map.set('c', '3');
      expect(map.size).toBe(2);
      expect(map.get('a')).toBe('1-updated');
      expect(map.get('b')).toBeUndefined();
      expect(map.get('c')).toBe('3');
    });

    it('triggers onChange callback on mutations', () => {
      const onChange = vi.fn();
      const map = new BoundedMap<string, string>(2, onChange);

      map.set('k1', 'v1');
      expect(onChange).toHaveBeenCalledTimes(1);

      map.delete('k1');
      expect(onChange).toHaveBeenCalledTimes(2);

      map.set('k2', 'v2');
      expect(onChange).toHaveBeenCalledTimes(3);

      map.clear();
      expect(onChange).toHaveBeenCalledTimes(4);
    });
  });

  describe('Disk persistence and atomic writes', () => {
    it('persists caches atomically to disk on flushThoughtSignatureCache()', () => {
      thoughtSignatureCache.set('call_1', 'sig_1');
      lastThoughtSignatureByTool.set('bash', 'sig_tool_1');
      toolCallNameCache.set('call_1', 'bash');

      flushThoughtSignatureCache();

      expect(fs.existsSync(testCacheFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testCacheFile, 'utf-8'));

      expect(content.version).toBe(1);
      expect(content.thoughtSignatureCache).toEqual({ call_1: 'sig_1' });
      expect(content.lastThoughtSignatureByTool).toEqual({ bash: 'sig_tool_1' });
      expect(content.toolCallNameCache).toEqual({ call_1: 'bash' });
    });

    it('populates caches from disk on loadThoughtSignatureCacheFromDisk()', () => {
      const diskData = {
        version: 1,
        thoughtSignatureCache: { call_99: 'sig_99', call_100: 'sig_100' },
        lastThoughtSignatureByTool: { glob: 'sig_glob' },
        toolCallNameCache: { call_99: 'glob' },
      };

      fs.mkdirSync(path.dirname(testCacheFile), { recursive: true });
      fs.writeFileSync(testCacheFile, JSON.stringify(diskData, null, 2), 'utf-8');

      loadThoughtSignatureCacheFromDisk();

      expect(thoughtSignatureCache.get('call_99')).toBe('sig_99');
      expect(thoughtSignatureCache.get('call_100')).toBe('sig_100');
      expect(lastThoughtSignatureByTool.get('glob')).toBe('sig_glob');
      expect(toolCallNameCache.get('call_99')).toBe('glob');
    });

    it('populates caches if disk data uses array of entries', () => {
      const diskData = {
        version: 1,
        thoughtSignatureCache: [['call_arr', 'sig_arr']],
        lastThoughtSignatureByTool: [['tool_arr', 'sig_tool_arr']],
        toolCallNameCache: [['call_arr', 'tool_arr']],
      };

      fs.mkdirSync(path.dirname(testCacheFile), { recursive: true });
      fs.writeFileSync(testCacheFile, JSON.stringify(diskData, null, 2), 'utf-8');

      loadThoughtSignatureCacheFromDisk();

      expect(thoughtSignatureCache.get('call_arr')).toBe('sig_arr');
      expect(lastThoughtSignatureByTool.get('tool_arr')).toBe('sig_tool_arr');
      expect(toolCallNameCache.get('call_arr')).toBe('tool_arr');
    });

    it('handles non-existent file gracefully without errors', () => {
      expect(fs.existsSync(testCacheFile)).toBe(false);
      expect(() => loadThoughtSignatureCacheFromDisk()).not.toThrow();
      expect(thoughtSignatureCache.size).toBe(0);
    });

    it('handles empty file gracefully', () => {
      fs.mkdirSync(path.dirname(testCacheFile), { recursive: true });
      fs.writeFileSync(testCacheFile, '   \n  ', 'utf-8');

      expect(() => loadThoughtSignatureCacheFromDisk()).not.toThrow();
      expect(thoughtSignatureCache.size).toBe(0);
    });

    it('handles corrupted JSON gracefully without crashing', () => {
      fs.mkdirSync(path.dirname(testCacheFile), { recursive: true });
      fs.writeFileSync(testCacheFile, '{ corrupted json: [invalid', 'utf-8');

      expect(() => loadThoughtSignatureCacheFromDisk()).not.toThrow();
      expect(thoughtSignatureCache.size).toBe(0);
    });

    it('handles invalid schema gracefully', () => {
      fs.mkdirSync(path.dirname(testCacheFile), { recursive: true });
      fs.writeFileSync(testCacheFile, JSON.stringify({ thoughtSignatureCache: 12345 }), 'utf-8');

      expect(() => loadThoughtSignatureCacheFromDisk()).not.toThrow();
      expect(thoughtSignatureCache.size).toBe(0);
    });

    it('debounces disk writes when items are modified', () => {
      vi.useFakeTimers();

      thoughtSignatureCache.set('debounced_key', 'debounced_val');

      // Before timer fires, disk file does not exist yet
      expect(fs.existsSync(testCacheFile)).toBe(false);

      // Fast-forward 500ms (not yet reached 1000ms debounce)
      vi.advanceTimersByTime(500);
      expect(fs.existsSync(testCacheFile)).toBe(false);

      // Another write resets/extends the debounce
      thoughtSignatureCache.set('debounced_key_2', 'debounced_val_2');
      vi.advanceTimersByTime(500);
      expect(fs.existsSync(testCacheFile)).toBe(false);

      // Advance remaining 500ms (total 1000ms since last write)
      vi.advanceTimersByTime(500);
      expect(fs.existsSync(testCacheFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(testCacheFile, 'utf-8'));
      expect(content.thoughtSignatureCache).toEqual({
        debounced_key: 'debounced_val',
        debounced_key_2: 'debounced_val_2',
      });
    });

    it('allows customizing cache file path and falling back to default', () => {
      expect(getCacheFilePath()).toBe(testCacheFile);
      setCacheFilePathForTest(null);
      expect(getCacheFilePath()).toContain('.gemini');
      expect(getCacheFilePath()).toContain('thought-signatures.json');
    });
  });
});
