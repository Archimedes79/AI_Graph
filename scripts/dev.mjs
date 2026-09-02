#!/usr/bin/env node
// Development: the engine on :8000 and Vite on :3000, in one terminal.
//
// Two processes because the editor's page is served by Vite while it is being
// written and by the engine once it is built; the API is the engine either way,
// and Vite proxies /api to it. Ctrl+C stops both.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shell = process.platform === 'win32';

const children = [
  spawn('node', [join(root, 'engine', 'src', 'main.ts'), '--editor', join(root, 'frontend', 'dist'), '--port', '8000'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, AI_GRAPH_NO_BROWSER: '1' },
  }),
  spawn('npm', ['run', 'dev', '--workspace', 'frontend'], { cwd: root, stdio: 'inherit', shell }),
];

const stop = () => { for (const child of children) if (child.exitCode === null) child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
for (const child of children) child.on('exit', (code) => { stop(); process.exit(code ?? 0); });
