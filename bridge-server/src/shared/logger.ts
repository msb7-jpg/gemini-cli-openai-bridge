/**
 * @license
 * Copyright 2025-2026 Intelligent-Internet / Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

const LOG_PREFIX = "[BRIDGE-SERVER]";

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function log(level: LogLevel, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const logFunction =
    console[level.toLowerCase() as "log" | "warn" | "error" | "debug"] || console.log;

  const finalArgs = args.map((arg) => {
    if (arg instanceof Error) {
      return { message: arg.message, stack: arg.stack };
    }
    return arg;
  });

  logFunction(`${timestamp} ${LOG_PREFIX} [${level}]`, ...finalArgs);
}

export const logger = {
  info: (...args: unknown[]): void => {
    log("INFO", ...args);
  },
  warn: (...args: unknown[]): void => {
    log("WARN", ...args);
  },
  error: (...args: unknown[]): void => {
    log("ERROR", ...args);
  },
  debug: (debugMode: boolean, ...args: unknown[]): void => {
    if (debugMode) {
      log("DEBUG", ...args);
    }
  },
};
