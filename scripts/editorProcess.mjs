// The editor as a process on a port: which one it is, and how to stop it.
//
// Shared by start.mjs (which restarts the editor) and stop.mjs (which only
// stops it). A port can be held by anything, so a listener is only stopped
// once it has answered as an AI-Graph server: a launcher that ends whatever
// happens to sit on port 8000 would end someone's database or dev server.

import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';

export const DEFAULT_PORT = 8000;

/** `--port 8023` from *args*, or the default. Throws on anything that is not a port. */
export function readPort(args) {
  const index = args.indexOf('--port');
  const value = index >= 0 ? Number(args[index + 1]) : DEFAULT_PORT;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid port: ${index >= 0 ? args[index + 1] : value}`);
  }
  return value;
}

/** Whether anything accepts a connection on *port*. */
export function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Whether what listens on *port* is an AI-Graph server. Every one -- editor
 * or deployed tool -- answers its schedule route with a `scheduled` flag.
 */
export async function isAiGraph(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/runtime/last`, { signal: AbortSignal.timeout(1500) });
    const body = await response.json();
    return typeof body?.scheduled === 'boolean';
  } catch {
    return false;
  }
}

/** The processes listening on *port*. */
function listenerPids(port) {
  if (process.platform === 'win32') {
    let output = '';
    try { output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }); } catch { return []; }
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      // A listening socket is the one whose remote address ends in port 0.
      const match = /^\s*TCP\s+\S+:(\d+)\s+\S+:0\s+\S+\s+(\d+)\s*$/i.exec(line);
      if (match && Number(match[1]) === port && Number(match[2]) > 0) pids.add(Number(match[2]));
    }
    return [...pids];
  }
  try {
    return execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

/**
 * Stop the AI-Graph server on *port*, and wait until the port is free.
 * Returns `false` when nothing was listening. Throws, and stops nothing, when
 * the port is held by a program that is not AI-Graph.
 */
export async function stopEditor(port) {
  if (!await isListening(port)) return false;
  if (!await isAiGraph(port)) {
    throw new Error(`Port ${port} is used by a program that is not AI-Graph. Stop it, or choose another port with --port.`);
  }
  for (const pid of listenerPids(port)) {
    if (pid === process.pid) continue;
    console.log(`Stopping the editor on port ${port} (PID ${pid})...`);
    try {
      if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
    } catch {
      // Gone already: what matters is the port, checked below.
    }
  }
  for (let attempt = 0; attempt < 30 && await isListening(port); attempt += 1) {
    await new Promise((wake) => setTimeout(wake, 100));
  }
  if (await isListening(port)) throw new Error(`Port ${port} is still in use. Stop the process manually and try again.`);
  return true;
}
