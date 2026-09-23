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

const README = `# AI-Graph

Unzip, then:

    ./run.sh          (macOS, Linux)
    run.cmd           (Windows -- type the extension, or double-click)

The editor opens in your browser, on http://127.0.0.1:8000 or, if something is
already there, the next free port -- the address is printed either way. Set
PORT to insist on one.

VERSION says which build this is and which commit it was made from.

## What this needs

Node ${NODE_MAJOR} or newer. That is the whole list: the engine is TypeScript that Node
runs directly, it has no dependencies, and the page in editor/dist is already
built. Nothing is installed, and nothing is installed while a graph runs.

    node --version

run.sh and run.cmd check this before starting and say so if it is missing or
too old; on Windows the window stays open until you have read it.

## What is in here

    run.sh, run.cmd   start it
    VERSION     what this was built from
    engine/     the engine and the editor's server, as source
    editor/dist the editor's page, built
    examples/   project folders to open from the editor's Open dialog
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
const extra = {
  'run.sh': runSh(LAUNCHER),
  'run.cmd': runCmd(LAUNCHER),
  'README.md': README,
  'VERSION': version(),
};
for (const [name, text] of Object.entries(extra)) {
  entries.push({ path: `${top}/${name}`, content: Buffer.from(text, 'utf8'), mode: zipMode(name) });
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, zip(entries));

const size = (entries.reduce((sum, e) => sum + e.content.length, 0) / 1024 / 1024).toFixed(1);
console.log(`${relative(ROOT, out) || out}: ${entries.length} files, ${size} MB uncompressed`);
