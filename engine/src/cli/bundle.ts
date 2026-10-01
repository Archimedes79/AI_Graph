// Handing the graph to someone else.
//
// A bundle is the tool as its project folder -- flow.json, its page in page/,
// a folder per node, as it was built -- the engine that runs it, and one
// command. One format: what a recipient opens is what the editor opens. Nothing is
// generated: the engine files are copied verbatim, so what a recipient runs is
// what was tested here, byte for byte. Code generation would produce a second
// implementation that is right on the day it is written and drifts from that
// afternoon on — the reason the older bundles vendor their engine too.
//
// What a recipient needs installed: Node. That is the whole list -- every
// authored body is JavaScript, so the interpreter that runs the engine runs
// them too.

import { chmod, copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Graph } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { withoutAuthoring } from '../authoring/handedOn.ts';
import { writeProject } from '../project/folder.ts';
import { installFolder } from '../ai/settings.ts';
import { NODE_MAJOR, runCmd, runSh, zipMode } from './launchers.ts';

/** `engine/src`: the tree a bundle copies. This file sits in its `cli/`. */
const ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What this particular graph needs to run somewhere else.
 *
 * Two things, and both are about the recipient rather than the graph. There
 * used to be a third and a fourth -- an interpreter, and the packages its code
 * nodes imported -- which is the list a bundle no longer has to carry now that
 * every body is JavaScript.
 */
export interface BundleNeeds {
  /** The graph has an interface, so a bundle without a page is only half of it. */
  interface: boolean;
  /** It asks a model, so the recipient needs a provider configured. */
  ai: boolean;
}

export function bundleNeeds(graph: Graph): BundleNeeds {
  const needs: BundleNeeds = { interface: false, ai: false };

  for (const node of graph.nodes) {
    const element = registry.node(node.node_type);
    if (!element) continue;

    const asked = element.deployNeeds(node);
    if (asked.needsInterface) needs.interface = true;
    if (asked.asksAi) needs.ai = true;

    // A graph inside a node runs in the bundle like everything else, so what
    // it needs the recipient has to have: a model it calls is a model they
    // must configure, wherever in the depth it sits.
    const held = element.nestedGraph(node);
    if (!held) continue;
    const inner = bundleNeeds(held);
    if (inner.ai) needs.ai = true;
    // A page in there is a check problem rather than a thing to carry, and a
    // bundle is not the place to find out: it is followed all the same, so a
    // graph that somehow has one is not shipped without its page.
    if (inner.interface) needs.interface = true;
  }

  return needs;
}

/** More than a bundle carries: a tool that starts on more is not handed on. */
const DATA_LIMIT_BYTES = 50 * 1024 * 1024;

/** Where a file the tool starts on goes when it came from outside the project. */
const DATA_DIR = 'data';

async function sizeOf(path: string): Promise<number> {
  const found = await stat(path);
  if (!found.isDirectory()) return found.size;
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) total += await sizeOf(join(path, entry.name));
  return total;
}

/** One file the tool starts on: where it is here, and where it goes in the bundle. */
interface Carried {
  named: string;
  source: string;
  place: string;
}

/**
 * The files a graph starts on -- what its pickers and folder inputs name --
 * every one of them: a tool is handed on whole, or not at all. A bundle that
 * left one out for its recipient to bring opened on "no such file", on
 * somebody else's path.
 *
 * A relative path inside keeps its place, so nothing in the graph changes: a
 * bundle runs from its own folder (the launchers see to that), and
 * `examples/data/population.csv` means there what it meant here. One
 * anywhere else -- absolute, as 📂 Browse… picks it, or through `..` -- goes
 * to `data/`, and the graph is told its new place (`moved`). A file that is
 * not there, or more than a bundle carries, stops the bundle before anything
 * is written, and says which.
 */
async function dataFiles(graph: Graph, from: string): Promise<Carried[]> {
  const wanted = new Set<string>();
  const collect = (inside: Graph): void => {
    for (const node of inside.nodes) {
      const element = registry.node(node.node_type);
      for (const path of element?.referencedPaths(node) ?? []) wanted.add(path);
      const held = element?.nestedGraph(node);
      // A file an inner node reads is a file the bundle must carry, and its
      // path is relative to the same project folder.
      if (held) collect(held);
    }
  };
  collect(graph);

  const carried: Carried[] = [];
  const missing: string[] = [];
  const places = new Set<string>();
  for (const named of wanted) {
    const tidy = normalize(named);
    const source = resolve(from, tidy);
    if (!existsSync(source)) { missing.push(`"${named}" is not there`); continue; }
    const size = await sizeOf(source);
    if (size > DATA_LIMIT_BYTES) {
      missing.push(`"${named}" is ${Math.round(size / 1024 / 1024)} MB, more than a bundle carries (${DATA_LIMIT_BYTES / 1024 / 1024} MB)`);
      continue;
    }
    let place = tidy.replace(/\\/g, '/');
    if (isAbsolute(named) || tidy.split(sep).includes('..')) {
      // Its own name, and a number where two share one.
      const stem = basename(source, extname(source));
      place = `${DATA_DIR}/${basename(source)}`;
      for (let n = 2; places.has(place); n += 1) place = `${DATA_DIR}/${stem}-${n}${extname(source)}`;
    }
    places.add(place);
    carried.push({ named, source, place });
  }
  if (missing.length) {
    throw new Error(`This tool cannot be handed on whole: it starts on files it cannot carry -- ${missing.join('; ')}. `
      + 'Choose files that are there and smaller, or clear those fields, and deploy again.');
  }
  return carried;
}

/**
 * *graph* told where the files it starts on are in the bundle: every setting
 * that names one it carried somewhere else names the new place. By value, not
 * by field -- which setting holds a path is each element's business, and a
 * path is the whole of the setting that holds it.
 */
function moved(graph: Graph, carried: Carried[]): Graph {
  const to = new Map(carried.filter((file) => file.named !== file.place).map((file) => [file.named, file.place]));
  if (!to.size) return graph;
  const retold = (value: unknown): unknown => {
    if (typeof value === 'string') return to.get(value) ?? value;
    if (Array.isArray(value)) return value.map(retold);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, retold(inner)]));
    return value;
  };
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, config: retold(node.config) as typeof node.config })) };
}

/** Every file under *dir*, relative to it, with `/`. */
async function filesIn(dir: string, under = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(dir, under), { withFileTypes: true })) {
    const path = under ? `${under}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await filesIn(dir, path));
    else found.push(path);
  }
  return found;
}

/** Every engine source file, so the copy is complete without a list to maintain. */
async function engineFiles(dir = ENGINE_ROOT): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // `host/editor/` is what only the editor serves -- generation, project
    // files, settings -- and it must never reach a recipient, who was handed a
    // tool and not an editor. `bundle.test.ts` is the check that says so.
    if (entry.isDirectory()) {
      if (entry.name === 'editor') continue;
      found.push(...await engineFiles(full));
    }
    // Tests stay behind: a recipient runs the graph, not its test suite.
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

/**
 * Where a bundle keeps the built page, beside the project. Not `page/`: in a
 * project folder that is the page itself, its blocks in `page.json`.
 */
export const WEB_DIR = 'web';

/**
 * The page this checkout built, when it has one: what a bundle carries, what
 * `--serve` serves a graph that brings none, and the editor's Deploy. Looked
 * up rather than passed, because the person writing a bundle should not have
 * to know where a build lands.
 */
export function builtPage(): string | undefined {
  const dist = join(installFolder(), 'editor', 'dist');
  return existsSync(join(dist, 'runtime.html')) ? dist : undefined;
}

/**
 * The built page a deployed tool serves, and only the files it references.
 *
 * Parsed out of `runtime.html` rather than listed: the editor's own chunks live
 * in the same folder, and a bundle that copied everything would ship the graph
 * editor to someone who was handed a finished tool.
 */
async function pageFiles(pageDir: string): Promise<string[]> {
  const html = join(pageDir, 'runtime.html');
  if (!existsSync(html)) return [];
  const source = await readFile(html, 'utf8');
  const referenced = [...source.matchAll(/(?:src|href)="\/?([^"]+)"/g)]
    .map((match) => match[1])
    .filter((path) => !path.startsWith('http'));
  return ['runtime.html', ...new Set(referenced)].filter((path) => existsSync(join(pageDir, path)));
}

/**
 * Write a runnable copy of *graph* into *target*.
 *
 * Returns the paths written, so a caller can zip exactly this and a test can
 * check that nothing was left out.
 */
export async function writeBundle(
  graph: Graph,
  target: string,
  options: { pageDir?: string; dataFrom?: string } = {},
): Promise<string[]> {
  // A bundle is something handed to someone else. One of a graph with no nodes
  // is a zip that starts, does nothing and says nothing -- and the person who
  // opens it has no way to tell that from a tool that failed.
  if (!graph.nodes.length) throw new Error('This graph has no nodes: there is nothing to hand over.');
  const needs = bundleNeeds(graph);
  // Asked first: what cannot be carried stops the bundle before a file is written.
  const data = await dataFiles(graph, options.dataFrom ?? process.cwd());
  const name = graph.metadata.name || 'graph';
  const written: string[] = [];

  const put = async (relativePath: string, content: string): Promise<void> => {
    const path = resolve(target, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    written.push(relativePath);
  };

  // The project folder, first, into the empty bundle -- what runs, not how each
  // node was written (`withoutAuthoring`), and the files it starts on where
  // they now are.
  await writeProject(target, withoutAuthoring(moved(graph, data)));
  written.push(...await filesIn(target));

  for (const file of await engineFiles()) {
    const relativePath = join('engine', relative(ENGINE_ROOT, file)).replace(/\\/g, '/');
    const path = resolve(target, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(file, path);
    written.push(relativePath);
  }
  // And the terms it comes under: whoever is handed any part of the engine is
  // handed those with it (LICENSE, "Notices").
  await copyFile(join(installFolder(), 'LICENSE'), resolve(target, 'LICENSE'));
  written.push('LICENSE');

  // The page, if this graph has one and a build is at hand. A bundle without
  // it still runs -- on the terminal, asking for what the blocks would have
  // asked for -- which is why a missing build is not an error here.
  let servesPage = false;
  if (needs.interface && options.pageDir) {
    for (const file of await pageFiles(options.pageDir)) {
      const relativePath = join(WEB_DIR, file).replace(/\\/g, '/');
      const path = resolve(target, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await copyFile(join(options.pageDir, file), path);
      written.push(relativePath);
      servesPage = true;
    }
  }

  for (const file of data) {
    await mkdir(dirname(resolve(target, file.place)), { recursive: true });
    await cp(file.source, resolve(target, file.place), { recursive: true });
    written.push(file.place);
  }

  // The same pair the downloadable package ships (see launchers.ts): from its
  // own folder, with Node checked before it is needed and a window that stays
  // open long enough to read a failure.
  const command = servesPage ? 'engine/main.ts . --serve' : 'engine/main.ts .';
  await put('run.cmd', runCmd({ command }));
  await put('run.sh', runSh({ command }));
  // A no-op on Windows; on a Mac or Linux box it is the difference between
  // `./run.sh` and "Permission denied".
  await chmod(resolve(target, 'run.sh'), zipMode('run.sh')!);
  await put('README.md', readme(name, needs, servesPage, data));

  return written;
}

function readme(name: string, needs: BundleNeeds, servesPage = false, data: Carried[] = []): string {
  const lines = [
    `# ${name}`,
    '',
    'A tool, as the project folder it was built as -- flow.json, its page in',
    'page/, a folder per node with its code -- and the engine that runs it.',
    'Nothing here was generated: the engine is a verbatim copy of the one the',
    'graph was built and tested on, so this runs what was tested rather than a',
    'second implementation of it.',
    '',
    '## Running it',
    '',
    '```',
    './run.sh          # or run.cmd on Windows',
    '```',
    '',
    ...(servesPage
      ? [
        'That opens the tool in your browser, and its page runs it: a button',
        'pressed, a file chosen.',
        '',
        'It takes port 8000, or the next free one if something else is already',
        'there, and prints the address it settled on. `--port 9000` picks one.',
        '',
        'It listens on localhost only, so nothing on your network can reach it.',
        'The page it serves is the page this graph was designed against, copied',
        'rather than rebuilt.',
      ]
      : [
        'The result is printed as JSON on stdout; questions and progress go to',
        'stderr, so `./run.sh | jq` works. `--every 5m` runs it again after each',
        'run finishes.',
      ]),
    '',
    '## What you need',
    '',
    // What the launchers check before they start: one number, said once.
    `- **Node ${NODE_MAJOR} or newer.** Nothing to install and nothing to build.`,
    '- Nothing else. Every code node in this graph is JavaScript, so the',
    '  interpreter that runs the engine runs them too.',
  ];

  if (needs.ai) {
    lines.push(
      '',
      '## The model',
      '',
      'This graph asks a model. Configure one through the environment:',
      '',
      '```',
      'AI_GRAPH_AI_PROVIDER=ollama          # or openai, anthropic, google, lmstudio,',
      'AI_GRAPH_AI_MODEL=llama3             #    openai_compatible, github_copilot',
      '```',
      '',
      'Hosted providers also want a key — `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,',
      '`GOOGLE_API_KEY` — and a self-hosted endpoint wants',
      '`OPENAI_COMPATIBLE_BASE_URL`. A local Ollama or LM Studio needs neither.',
    );
  }

  if (needs.interface) {
    lines.push(
      '',
      '## The page',
      '',
      'This graph has a page. Running it from the command line works and fills',
      "the page's blocks with values, but does not draw them; the fields it",
      'would otherwise ask you to fill are asked for on the terminal instead.',
    );
  }

  if (data.length) {
    lines.push(
      '', '## Its files', '',
      'The files this graph starts on came with it -- in the same relative place',
      'they had where it was built, or, from elsewhere on that machine, in',
      `\`${DATA_DIR}/\`:`, '',
      ...data.map((file) => `- \`${file.place}\``),
    );
  }

  lines.push(
    '', '## Licence', '',
    ...(servesPage
      ? [
        'The engine in engine/ and the page in web/ come under the terms in LICENSE,',
        'except the packages the page is built from: web/licenses.txt names each,',
        'with its own licence.',
      ]
      : ['The engine in engine/ comes under the terms in LICENSE.']),
    'The tool itself -- flow.json, page/ and nodes/ -- belongs to whoever built it.',
  );

  lines.push('');
  return lines.join('\n');
}
