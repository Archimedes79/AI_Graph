import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = readPort(process.argv.slice(2));

if (Number(process.versions.node.split('.')[0]) < 24) {
  fail(`Node.js 24 or newer is required. Found ${process.version}.`);
}

await stopListener(port);

if (!await exists(join(root, 'node_modules'))) {
  run('npm', ['ci'], 'Installing dependencies...');
}

const page = join(root, 'editor', 'dist', 'index.html');
if (!await exists(page) || await sourcesAreNewer(page)) {
  run('npm', ['run', 'build'], 'Building the editor...');
}

const child = spawn(process.execPath, ['engine/src/main.ts', '--editor', 'editor/dist', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: false,
});

const forward = (signal) => child.kill(signal);
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on('error', (error) => fail(`Could not start the editor: ${error.message}`));

function readPort(args) {
  const index = args.indexOf('--port');
  const value = index >= 0 ? Number(args[index + 1]) : 8000;
  if (!Number.isInteger(value) || value < 1 || value > 65535) fail(`Invalid port: ${args[index + 1] ?? value}`);
  return value;
}

async function sourcesAreNewer(pagePath) {
  const builtAt = (await stat(pagePath)).mtimeMs;
  const files = [
    'package.json', 'package-lock.json', 'editor/package.json', 'editor/index.html',
    'editor/tsconfig.json', 'editor/tsconfig.node.json', 'editor/vite.config.ts',
    'editor/tailwind.config.js', 'editor/postcss.config.js',
  ];
  for (const file of files) if (await newerThan(join(root, file), builtAt)) return true;
  return newerInDirectory(join(root, 'editor', 'src'), builtAt);
}

async function newerInDirectory(directory, builtAt) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && await newerInDirectory(path, builtAt)) return true;
    if (entry.isFile() && await newerThan(path, builtAt)) return true;
  }
  return false;
}

async function newerThan(path, builtAt) {
  try { return (await stat(path)).mtimeMs > builtAt; } catch { return false; }
}

async function stopListener(listenPort) {
  const pids = process.platform === 'win32' ? windowsPids(listenPort) : unixPids(listenPort);
  for (const pid of pids) {
    if (pid === process.pid) continue;
    console.log(`Stopping the existing editor on port ${listenPort} (PID ${pid})...`);
    if (process.platform === 'win32') {
      try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  }
  for (let attempt = 0; attempt < 20 && await isListening(listenPort); attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
  }
  if (await isListening(listenPort)) fail(`Port ${listenPort} is still in use. Stop the other process and try again.`);
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
  return new Promise((resolveResult) => {
    const socket = createConnection({ host: '127.0.0.1', port: listenPort });
    socket.once('connect', () => { socket.destroy(); resolveResult(true); });
    socket.once('error', () => resolveResult(false));
  });
}

function run(command, args, message) {
  console.log(message);
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: false });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}