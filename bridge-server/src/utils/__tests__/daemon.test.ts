/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readPidFile,
  writePidFile,
  removePidFile,
  formatUptime,
  checkBridgeHealth,
  isPidRunning,
} from "../daemon.js";

describe("daemon utils", () => {
  describe("formatUptime", () => {
    it("formats seconds correctly", () => {
      const now = Date.now();
      expect(formatUptime(now - 45 * 1000)).toBe("45s");
    });

    it("formats minutes and seconds correctly", () => {
      const now = Date.now();
      expect(formatUptime(now - (2 * 60 + 15) * 1000)).toBe("2m 15s");
    });

    it("formats hours and minutes correctly", () => {
      const now = Date.now();
      expect(formatUptime(now - (3 * 3600 + 40 * 60) * 1000)).toBe("3h 40m");
    });
  });

  describe("isPidRunning", () => {
    it("returns true for current process PID", () => {
      expect(isPidRunning(process.pid)).toBe(true);
    });

    it("returns false for an invalid or non-existent PID", () => {
      // 99999999 is typically unused
      expect(isPidRunning(99999999)).toBe(false);
    });
  });

  describe("readPidFile, writePidFile, removePidFile", () => {
    const tmpDir = path.join(
      os.tmpdir(),
      `daemon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const customPidPath = path.join(tmpDir, "test.pid");

    beforeEach(() => {
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it("returns null if PID file does not exist", () => {
      expect(readPidFile(customPidPath)).toBeNull();
    });

    it("writes and reads PID file correctly", () => {
      const info = {
        pid: 12345,
        port: 8765,
        host: "127.0.0.1",
        startTime: Date.now(),
      };

      writePidFile(info, customPidPath);
      expect(fs.existsSync(customPidPath)).toBe(true);

      const read = readPidFile(customPidPath);
      expect(read).toEqual(info);
    });

    it("returns null on corrupted PID file", () => {
      fs.writeFileSync(customPidPath, "{ invalid json", "utf-8");
      expect(readPidFile(customPidPath)).toBeNull();
    });

    it("removes PID file correctly", () => {
      const info = {
        pid: 12345,
        port: 8765,
        host: "127.0.0.1",
        startTime: Date.now(),
      };

      writePidFile(info, customPidPath);
      expect(fs.existsSync(customPidPath)).toBe(true);

      removePidFile(customPidPath);
      expect(fs.existsSync(customPidPath)).toBe(false);
    });
  });

  describe("checkBridgeHealth", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("returns ok: true and version when health check endpoint responds successfully", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: "0.1.18" }),
      } as unknown as Response);

      const result = await checkBridgeHealth(8765, "127.0.0.1", 500);
      expect(result).toEqual({ ok: true, version: "0.1.18" });
    });

    it("returns ok: false when response is not ok", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response);

      const result = await checkBridgeHealth(8765, "127.0.0.1", 500);
      expect(result).toEqual({ ok: false });
    });

    it("returns ok: false when fetch throws or times out", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const result = await checkBridgeHealth(8765, "127.0.0.1", 500);
      expect(result).toEqual({ ok: false });
    });
  });
});
