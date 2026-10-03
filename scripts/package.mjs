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
import { execFileSync } from 'node:child_process';
import { zip } from '../engine/src/host/editor/zip.ts';
import { NODE_MAJOR, runCmd, runSh, zipMode } from '../engine/src/cli/launchers.ts';

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

// The same launchers every deploy bundle gets (engine/src/cli/launchers.ts):
// they check for Node before it is needed, start from their own folder, and
// keep a Windows window open long enough to read a failure. No port is passed
// unless PORT is set, so the engine takes the first free one from 8000 --
// the version before always passed 8000, and died on a machine that already
// had an editor running there.
const LAUNCHER = { command: 'engine/src/main.ts --editor editor/dist', portFromEnv: true };

/**
 * What this zip was built from, in a file beside the README.
 *
 * A downloaded folder otherwise has no way to say how old it is, and "is this
 * the current code?" was a question nobody could answer from the outside. CI
 * names the build (a tag, or `latest`); a local build asks git.
 */
function version() {
  const git = (...args) => {
    try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
  };
  const commit = process.env.GITHUB_SHA || git('rev-parse', 'HEAD') || 'unknown';
  const name = process.env.AI_GRAPH_VERSION || git('describe', '--tags', '--always', '--dirty') || 'unknown';
  return `AI-Graph ${name}\ncommit ${commit}\nbuilt ${new Date().toISOString()}\n`;
}

// `--node <folder>`: an unpacked Node.js download for one system -- node.exe
// at its top on Windows, bin/node elsewhere -- whose binary and LICENSE go into
// the zip as node/. That zip is for that system only, and needs nothing
// installed: having to install Node 24 first was what stopped people who only
// wanted to try it, and was why they reached for the container instead.
const args = process.argv.slice(2);
const nodeAt = args.indexOf('--node');
const nodeFolder = nodeAt >= 0 ? args.splice(nodeAt, 2)[1] : undefined;

/** The Node binary in *folder*, and where it goes in the zip. */
async function bundledNode(folder) {
  for (const [from, to] of [['node.exe', 'node/node.exe'], ['bin/node', 'node/node']]) {
    try {
      return { to, content: await readFile(join(folder, from)), license: await readFile(join(folder, 'LICENSE')) };
    } catch {
      // Not this system's layout: the other one.
    }
  }
  throw new Error(`No node.exe or bin/node, with its LICENSE, in ${folder}`);
}

const node = nodeFolder ? await bundledNode(nodeFolder) : undefined;

const NEEDS = node
  ? `Nothing. Node.js, which runs it, is in node/ -- with its licence, node/LICENSE --
and the launchers use it. The engine is TypeScript that Node runs directly, it
has no dependencies, and the page in editor/dist is already built. Nothing is
installed, and nothing is installed while a graph runs.

This download is for one system. The one ending in -node-required runs on any,
with a Node ${NODE_MAJOR} or newer of your own.`
  : `Node ${NODE_MAJOR} or newer. That is the whole list: the engine is TypeScript that Node
runs directly, it has no dependencies, and the page in editor/dist is already
built. Nothing is installed, and nothing is installed while a graph runs.

    node --version

The launchers check this before starting and say so if it is missing or too
old; on Windows the window stays open until you have read it. The downloads
named after a system (windows-x64, macos-arm64, ...) carry their own Node and
need nothing.`;

const README = `# AI-Graph

Unzip, then:

    run.cmd           (Windows -- double-click it)
    run.command       (macOS -- double-click it; if macOS refuses the first time,
                       System Settings > Privacy & Security > Open Anyway)
    ./run.sh          (macOS, Linux, in a terminal)

The editor opens in your browser, on http://127.0.0.1:8000 or, if something is
already there, the next free port -- the address is printed either way. Set
PORT to insist on one.

VERSION says which build this is and which commit it was made from.

## What this needs

${NEEDS}

## What is in here

    run.*       start it${node ? '\n    node/       Node.js, which runs it, and its licence' : ''}
    VERSION     what this was built from
    engine/     the engine and the editor's server, as source
    editor/dist the editor's page, built; its licenses.txt names the
                packages it is built from, each with its licence
    examples/   project folders to open from the editor's Open dialog
    LICENSE     the terms AI-Graph comes under

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

const out = args[0] ?? join(ROOT, 'ai-graph.zip');
// Everything sits under one folder named after the file, so unzipping in a
// downloads directory produces one directory rather than scattering 87 files
// across it.
const top = basename(out).replace(/\.zip$/i, '');

const entries = [];
for (const path of files) {
  entries.push({ path: `${top}/${path}`, content: await readFile(join(ROOT, path)) });
}
const extra = {
  'run.sh': runSh(LAUNCHER),
  // The same script under the name a Mac's Finder runs on a double-click, in a
  // Terminal window: run.sh it opens in a text editor.
  'run.command': runSh(LAUNCHER),
  'run.cmd': runCmd(LAUNCHER),
  'README.md': README,
  'VERSION': version(),
};
for (const [name, text] of Object.entries(extra)) {
  entries.push({ path: `${top}/${name}`, content: Buffer.from(text, 'utf8'), mode: zipMode(name) });
}
if (node) {
  entries.push({ path: `${top}/${node.to}`, content: node.content, mode: zipMode(node.to) });
  entries.push({ path: `${top}/node/LICENSE`, content: node.license });
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, zip(entries));

const size = (entries.reduce((sum, e) => sum + e.content.length, 0) / 1024 / 1024).toFixed(1);
console.log(`${relative(ROOT, out) || out}: ${entries.length} files, ${size} MB uncompressed`);
