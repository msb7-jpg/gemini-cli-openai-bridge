/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

const ANSI_CYAN = "\x1b[36m";
const ANSI_DIM = "\x1b[2m";
const ANSI_RESET = "\x1b[0m";
const cyan = (text: string) => `${ANSI_CYAN}${text}${ANSI_RESET}`;
const dim = (text: string) => `${ANSI_DIM}${text}${ANSI_RESET}`;

/**
 * Interactive terminal spinner for long-running CLI startup operations.
 */
export class TerminalSpinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private index = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private message: string;
  private startTime: number = Date.now();
  private isTTY = Boolean(process.stdout.isTTY);

  constructor(message: string) {
    this.message = message;
  }

  /**
   * Starts rendering the spinner interval on TTY stdout or logs a static message on non-TTY.
   */
  public start(): void {
    this.startTime = Date.now();
    if (!this.isTTY) {
      console.log(`${this.message}...`);
      return;
    }
    this.render();
    this.intervalId = setInterval(() => {
      this.index = (this.index + 1) % this.frames.length;
      this.render();
    }, 80);
  }

  /**
   * Updates the status message displayed next to the spinner.
   * @param message - New status message.
   */
  public update(message: string): void {
    this.message = message;
    if (this.isTTY) this.render();
  }

  private render(): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const frame = this.frames[this.index];
    process.stdout.write(`\r\x1b[K${cyan(frame)} ${this.message} ${dim(`(${elapsed}s)`)}`);
  }

  /**
   * Stops the spinner interval and optionally clears the current terminal line.
   * @param clear - Whether to erase the spinner line from stdout.
   */
  public stop(clear = true): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.isTTY && clear) {
      process.stdout.write("\r\x1b[K");
    }
  }
}

/**
 * Probes the `/health` endpoint of the bridge server.
 * @param port - Target TCP port.
 * @param host - Target host address.
 * @param timeoutMs - Request timeout in milliseconds.
 * @returns Object indicating whether the server is online and its reported version.
 */
export async function checkBridgeHealth(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 1500,
): Promise<{ ok: boolean; version?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      return { ok: true, version: data.version };
    }
  } catch {
    // offline or unreachable
  }
  return { ok: false };
}

/**
 * Polls `/health` until the spawned daemon process becomes ready or the startup timeout expires.
 * @param childPid - Spawned daemon process ID.
 * @param port - Target TCP port.
 * @param host - Target host address.
 * @param timeoutSec - Maximum startup timeout in seconds.
 * @param spinner - Active terminal spinner instance.
 * @param isProcessAlive - Callback checking whether `childPid` is still running.
 * @returns Readiness status and version string.
 */
export async function pollDaemonStartupHealth(
  childPid: number,
  port: number,
  host: string,
  timeoutSec: number,
  spinner: TerminalSpinner,
  isProcessAlive: (pid: number) => boolean,
): Promise<{ online: boolean; version: string }> {
  const pollIntervalMs = 250;
  const maxAttempts = Math.round((timeoutSec * 1000) / pollIntervalMs);
  const loopStart = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    if (!isProcessAlive(childPid)) {
      break;
    }

    const elapsed = (Date.now() - loopStart) / 1000;
    if (elapsed >= 25) {
      spinner.update("Waiting for server readiness & network binding");
    } else if (elapsed >= 12) {
      spinner.update("Refreshing credentials & initializing provider models");
    } else if (elapsed >= 5) {
      spinner.update("Loading modules & configuring Gemini client");
    }

    const health = await checkBridgeHealth(port, host, 800);
    if (health.ok) {
      return { online: true, version: health.version || "" };
    }
  }

  return { online: false, version: "" };
}
