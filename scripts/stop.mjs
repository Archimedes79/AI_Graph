import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';

const port = readPort(process.argv.slice(2));
const pids = process.platform === 'win32' ? windowsPids(port) : unixPids(port);

if (!pids.length) {
  console.log(`No editor is running on port ${port}.`);
  process.exit(0);
}

for (const pid of pids) {
  console.log(`Stopping the editor on port ${port} (PID ${pid})...`);
  if (process.platform === 'win32') {
    try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

for (let attempt = 0; attempt < 20 && await isListening(port); attempt += 1) {
  await new Promise((done) => setTimeout(done, 100));
}
if (await isListening(port)) {
  console.error(`Port ${port} is still in use. Stop the process manually and try again.`);
  process.exit(1);
}
console.log('Editor stopped.');

function readPort(args) {
  const index = args.indexOf('--port');
  const value = index >= 0 ? Number(args[index + 1]) : 8000;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`Invalid port: ${args[index + 1] ?? value}`);
    process.exit(1);
  }
  return value;
}

function windowsPids(listenPort) {
  let output = '';
  try { output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }); } catch { return []; }
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+:0\s+\S+\s+(\d+)\s*$/i);
    if (match && Number(match[1]) === listenPort && Number(match[2]) > 0) pids.add(Number(match[2]));
  }
  return [...pids];
}

function unixPids(listenPort) {
  try {
    const output = execFileSync('lsof', ['-tiTCP:' + listenPort, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return output.split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}

function isListening(listenPort) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: listenPort });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}