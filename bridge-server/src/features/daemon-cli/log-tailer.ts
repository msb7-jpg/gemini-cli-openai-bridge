/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const GEMINI_DIR = path.join(os.homedir(), ".gemini");
export const LOG_FILE = path.join(GEMINI_DIR, "bridge.log");

const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

/**
 * Displays the last N lines of the bridge daemon log file and optionally follows new output.
 * @param follow - Whether to watch the log file in real time.
 * @param lines - Number of trailing lines to print initially.
 */
export function handleLogs(follow = false, lines = 40): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(yellow(`Log file does not exist yet at ${LOG_FILE}`));
    return;
  }

  const content = fs.readFileSync(LOG_FILE, "utf-8");
  const allLines = content.split("\n");
  const displayLines = allLines.slice(-lines).join("\n");
  console.log(displayLines);

  if (follow) {
    console.log(dim("\n--- Following logs in real time (Ctrl+C to exit) ---"));
    let currentSize = fs.statSync(LOG_FILE).size;
    fs.watchFile(LOG_FILE, { interval: 500 }, (curr) => {
      if (curr.size > currentSize) {
        const stream = fs.createReadStream(LOG_FILE, {
          start: currentSize,
          end: curr.size,
          encoding: "utf-8",
        });
        stream.on("data", (chunk) => process.stdout.write(chunk));
        currentSize = curr.size;
      }
    });
  }
}

/**
 * Prints newly written log lines produced during a failed daemon startup attempt.
 * @param logStartOffset - Byte offset in `bridge.log` before daemon spawn.
 */
export function printStartupFailureLogs(logStartOffset: number): void {
  if (!fs.existsSync(LOG_FILE)) {
    return;
  }

  const currentSize = fs.statSync(LOG_FILE).size;
  if (currentSize > logStartOffset) {
    try {
      const fileDesc = fs.openSync(LOG_FILE, "r");
      const bytesToRead = currentSize - logStartOffset;
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fileDesc, buffer, 0, bytesToRead, logStartOffset);
      fs.closeSync(fileDesc);

      const content = buffer.toString("utf-8");
      const lines = content.split("\n").filter((line) => line.trim().length > 0);
      if (lines.length > 0) {
        console.error(yellow("\nStartup logs:"));
        console.error(lines.slice(-25).join("\n"));
        return;
      }
    } catch {
      // fall through to default log tail
    }
  }

  console.error(yellow("\nLast log lines:"));
  handleLogs(false, 15);
}
