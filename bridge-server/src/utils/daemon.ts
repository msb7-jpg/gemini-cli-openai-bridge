/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const PID_FILE = path.join(GEMINI_DIR, 'bridge.pid');
const LOG_FILE = path.join(GEMINI_DIR, 'bridge.log');

export interface PidInfo {
  pid: number;
  port: number;
  host: string;
  startTime: number;
}

const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;
const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

function ensureGeminiDir(): void {
  if (!fs.existsSync(GEMINI_DIR)) {
    fs.mkdirSync(GEMINI_DIR, { recursive: true });
  }
}

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPidFile(): PidInfo | null {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    if (!content) return null;
    const parsed = JSON.parse(content) as PidInfo;
    if (parsed && typeof parsed.pid === 'number') {
      return parsed;
    }
  } catch {
    // corrupted or unreadable file
  }
  return null;
}

export function writePidFile(info: PidInfo): void {
  ensureGeminiDir();
  fs.writeFileSync(PID_FILE, JSON.stringify(info, null, 2), 'utf-8');
}

export function removePidFile(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // ignore
  }
}

export async function checkBridgeHealth(
  port: number,
  host = '127.0.0.1',
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

function formatUptime(startTime: number): string {
  const diffSec = Math.floor((Date.now() - startTime) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s`;
  const diffHours = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  return `${diffHours}h ${remMin}m`;
}

export async function handleStatus(port: number, host = '127.0.0.1'): Promise<void> {
  const pidInfo = readPidFile();
  const effectivePort = pidInfo?.port || port;
  const effectiveHost = pidInfo?.host || host;

  const health = await checkBridgeHealth(effectivePort, effectiveHost);

  if (pidInfo && isPidRunning(pidInfo.pid) && health.ok) {
    console.log(green(`${bold('● Gemini Bridge')} está ${bold('ATIVO')} (Online)`));
    console.log(`  ${cyan('PID:')}       ${pidInfo.pid}`);
    console.log(`  ${cyan('Porta:')}     ${effectivePort}`);
    console.log(`  ${cyan('Uptime:')}    ${formatUptime(pidInfo.startTime)}`);
    if (health.version) {
      console.log(`  ${cyan('Versão:')}    ${health.version}`);
    }
    console.log(`  ${cyan('OpenAI:')}    http://${effectiveHost}:${effectivePort}/v1/chat/completions`);
    console.log(`  ${cyan('Anthropic:')} http://${effectiveHost}:${effectivePort}/v1/messages`);
    console.log(`  ${cyan('Models:')}    http://${effectiveHost}:${effectivePort}/v1/models`);
    console.log(`  ${cyan('Logs:')}      ${LOG_FILE}`);
    console.log('');
    console.log(dim(`Comandos: 'gemini-bridge stop' | 'gemini-bridge restart' | 'gemini-bridge logs'`));
  } else if (health.ok) {
    // Process running without PID file or orphan
    console.log(yellow(`${bold('● Gemini Bridge')} está respondendo na porta ${effectivePort}, mas sem registro PID recente.`));
    console.log(`  ${cyan('OpenAI:')}    http://${effectiveHost}:${effectivePort}/v1/chat/completions`);
  } else {
    // Stale PID cleanup
    if (pidInfo && !isPidRunning(pidInfo.pid)) {
      removePidFile();
    }
    console.log(red(`${bold('○ Gemini Bridge')} está ${bold('INATIVO')}`));
    console.log(dim(`Para iniciar em segundo plano execute: ${bold('gemini-bridge')} ou ${bold('gemini-bridge start')}`));
  }
}

export async function handleStop(port: number, host = '127.0.0.1'): Promise<void> {
  const pidInfo = readPidFile();

  if (!pidInfo || !isPidRunning(pidInfo.pid)) {
    const health = await checkBridgeHealth(port, host, 500);
    if (!health.ok) {
      removePidFile();
      console.log(yellow('○ Gemini Bridge já se encontra inativo.'));
      return;
    }
  }

  const pid = pidInfo?.pid;
  if (!pid) {
    console.log(yellow(`⚠ Não foi possível determinar o PID do Gemini Bridge na porta ${port}.`));
    return;
  }

  console.log(`Encerrando Gemini Bridge (PID ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    // Already exited
  }

  // Wait up to 3 seconds for graceful shutdown
  let exited = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!isPidRunning(pid)) {
      exited = true;
      break;
    }
  }

  // Force kill if necessary
  if (!exited && isPidRunning(pid)) {
    console.log(yellow(`Forçando encerramento (SIGKILL) do PID ${pid}...`));
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }

  removePidFile();
  console.log(green(`✓ Gemini Bridge encerrado com sucesso.`));
}

export function handleLogs(follow = false, lines = 40): void {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(yellow(`Arquivo de log ainda não existe em ${LOG_FILE}`));
    return;
  }

  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  const allLines = content.split('\n');
  const displayLines = allLines.slice(-lines).join('\n');
  console.log(displayLines);

  if (follow) {
    console.log(dim('\n--- Acompanhando logs em tempo real (Ctrl+C para sair) ---'));
    let currentSize = fs.statSync(LOG_FILE).size;
    fs.watchFile(LOG_FILE, { interval: 500 }, (curr) => {
      if (curr.size > currentSize) {
        const stream = fs.createReadStream(LOG_FILE, {
          start: currentSize,
          end: curr.size,
          encoding: 'utf-8',
        });
        stream.on('data', (chunk) => process.stdout.write(chunk));
        currentSize = curr.size;
      }
    });
  }
}

export async function startDaemon(
  port: number,
  host: string,
  extraArgs: string[],
  scriptPath: string,
): Promise<void> {
  ensureGeminiDir();

  // 1. Check if already running
  const pidInfo = readPidFile();
  if (pidInfo && isPidRunning(pidInfo.pid)) {
    const health = await checkBridgeHealth(pidInfo.port, pidInfo.host, 1000);
    if (health.ok) {
      console.log(green(`${bold('● Gemini Bridge')} já está em execução!`));
      console.log(`  ${cyan('PID:')}       ${pidInfo.pid}`);
      console.log(`  ${cyan('Porta:')}     ${pidInfo.port}`);
      console.log(`  ${cyan('Uptime:')}    ${formatUptime(pidInfo.startTime)}`);
      console.log(`  ${cyan('OpenAI:')}    http://${pidInfo.host}:${pidInfo.port}/v1/chat/completions`);
      console.log(`  ${cyan('Anthropic:')} http://${pidInfo.host}:${pidInfo.port}/v1/messages`);
      console.log(`  ${cyan('Models:')}    http://${pidInfo.host}:${pidInfo.port}/v1/models`);
      return;
    }
  }

  // Also check if port is currently responding
  const currentHealth = await checkBridgeHealth(port, host, 800);
  if (currentHealth.ok) {
    console.log(green(`${bold('● Gemini Bridge')} já está ativo e respondendo na porta ${port}.`));
    return;
  }

  // 2. Open log file
  const logFd = fs.openSync(LOG_FILE, 'a');

  // 3. Prepare child args
  const childArgs = [
    scriptPath,
    ...extraArgs.filter(
      (a) =>
        a !== 'start' &&
        a !== 'status' &&
        a !== 'stop' &&
        a !== 'restart' &&
        a !== 'logs' &&
        !a.startsWith('--foreground') &&
        !a.startsWith('-f'),
    ),
    '--server-process',
    '--foreground',
  ];

  console.log(`Iniciando Gemini Bridge em segundo plano...`);

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });

  const childPid = child.pid;
  if (!childPid) {
    console.error(red('Falha ao spawnar processo do bridge.'));
    process.exit(1);
  }

  child.unref();

  writePidFile({
    pid: childPid,
    port,
    host,
    startTime: Date.now(),
  });

  // 4. Wait for health check confirmation
  let online = false;
  let version = '';
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!isPidRunning(childPid)) {
      break;
    }
    const health = await checkBridgeHealth(port, host, 500);
    if (health.ok) {
      online = true;
      version = health.version || '';
      break;
    }
  }

  if (online) {
    console.log(green(`${bold('✓ Gemini Bridge iniciado com sucesso (detached)!')}`));
    console.log(`  ${cyan('PID:')}       ${childPid}`);
    console.log(`  ${cyan('Porta:')}     ${port}`);
    if (version) {
      console.log(`  ${cyan('Versão:')}    ${version}`);
    }
    console.log(`  ${cyan('OpenAI:')}    http://${host}:${port}/v1/chat/completions`);
    console.log(`  ${cyan('Anthropic:')} http://${host}:${port}/v1/messages`);
    console.log(`  ${cyan('Models:')}    http://${host}:${port}/v1/models`);
    console.log(`  ${cyan('Logs:')}      ${LOG_FILE}`);
    console.log('');
    console.log(dim(`Comandos úteis:`));
    console.log(dim(`  gemini-bridge status   (verificar status)`));
    console.log(dim(`  gemini-bridge stop     (parar o servidor)`));
    console.log(dim(`  gemini-bridge restart  (reiniciar o servidor)`));
    console.log(dim(`  gemini-bridge logs     (visualizar logs)`));
  } else {
    console.error(red(`❌ O servidor não respondeu a tempo ou encerrou inesperadamente.`));
    if (fs.existsSync(LOG_FILE)) {
      console.error(yellow('\nÚltimas linhas de log:'));
      handleLogs(false, 15);
    }
    removePidFile();
    process.exit(1);
  }
}
