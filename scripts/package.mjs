// Build the downloadable package: AI-Graph, ready to run, nothing to install.
//
// The engine has no runtime dependencies -- only devDependencies -- and Node
// runs its TypeScript unbuilt. So everything a recipient needs is source plus
// the already-built page: unzip, run the script, no `npm install`, no build,
// no Docker.
//
// Tests are left out; nothing else is. The editor's own server routes stay in,
// because this package *is* the editor, unlike a deploy bundle, which is one
// graph and drops them.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from '../engine/src/host/editor/zip.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file under *dir*, recursively, as paths relative to ROOT. */
async function walk(dir, keep = () => true) {
  const found = [];
  let entries;
  try {
    entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) found.push(...await walk(path, keep));
    else if (keep(path)) found.push(path);
  }
  return found;
}

const RUN_SH = `#!/bin/sh
# AI-Graph. Needs Node 24 or newer, and nothing else.
exec node engine/src/main.ts --editor editor/dist --port "\${PORT:-8000}" "$@"
`;

const RUN_CMD = [
  '@echo off',
  'rem AI-Graph. Needs Node 24 or newer, and nothing else.',
  'if "%PORT%"=="" set PORT=8000',
  'node engine\\src\\main.ts --editor editor\\dist --port %PORT% %*',
  '',
].join('\r\n');

const README = `# AI-Graph

Unzip, then:

    ./run.sh          (macOS, Linux)
    run.cmd           (Windows -- type the extension, or double-click)

The editor opens at http://127.0.0.1:8000. Set PORT to use another one.

## What this needs

Node 24 or newer. That is the whole list: the engine is TypeScript that Node
runs directly, it has no dependencies, and the page in editor/dist is already
built. Nothing is installed, and nothing is installed while a graph runs.

    node --version

## What is in here

    engine/     the engine and the editor's server, as source
    editor/dist the editor's page, built
    examples/   graphs to open from the editor's Open dialog
    LICENSE

A graph you build here can be handed on with the Deploy button, which writes a
folder of its own -- that one holds a single graph and no editor.
`;

const files = [
  ...await walk('engine/src', (path) => path.endsWith('.ts') && !path.endsWith('.test.ts')),
  'engine/package.json',
  ...await walk('editor/dist'),
  ...await walk('examples'),
  'LICENSE',
];

const out = process.argv[2] ?? join(ROOT, 'ai-graph.zip');
// Everything sits under one folder named after the file, so unzipping in a
// downloads directory produces one directory rather than scattering 87 files
// across it.
const top = basename(out).replace(/\.zip$/i, '');

const entries = [];
for (const path of files) {
  entries.push({ path: `${top}/${path}`, content: await readFile(join(ROOT, path)) });
}
entries.push({ path: `${top}/run.sh`, content: Buffer.from(RUN_SH, 'utf8') });
entries.push({ path: `${top}/run.cmd`, content: Buffer.from(RUN_CMD, 'utf8') });
entries.push({ path: `${top}/README.md`, content: Buffer.from(README, 'utf8') });

await mkdir(dirname(out), { recursive: true });
await writeFile(out, zip(entries));

const size = (entries.reduce((sum, e) => sum + e.content.length, 0) / 1024 / 1024).toFixed(1);
console.log(`${relative(ROOT, out) || out}: ${entries.length} files, ${size} MB uncompressed`);
