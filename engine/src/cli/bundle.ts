// Handing the graph to someone else.
//
// A bundle is the graph, the engine that runs it, and one command. Nothing is
// generated: the engine files are copied verbatim, so what a recipient runs is
// what was tested here, byte for byte. Code generation would produce a second
// implementation that is right on the day it is written and drifts from that
// afternoon on — the reason the older bundles vendor their engine too.
//
// What a recipient needs installed: Node. That is the whole list -- every
// authored body is JavaScript, so the interpreter that runs the engine runs
// them too.

import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Graph } from '../graph.ts';
import { registry } from '../elements/registry.ts';

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

/** More than this and the data is the recipient's to bring, not the bundle's to carry. */
const DATA_LIMIT_BYTES = 50 * 1024 * 1024;

async function sizeOf(path: string): Promise<number> {
  const found = await stat(path);
  if (!found.isDirectory()) return found.size;
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) total += await sizeOf(join(path, entry.name));
  return total;
}

/**
 * The files a graph names as its defaults, copied to the same relative place.
 *
 * The same place, so nothing in the graph is rewritten: a bundle runs from its
 * own folder (the launchers see to that), and `examples/data/population.csv`
 * means there what it meant here. Only relative paths that stay inside --
 * an absolute path is somebody's machine, and `..` is somewhere a bundle has
 * no business writing to.
 */
async function dataFiles(graph: Graph, from: string, target: string): Promise<{ copied: string[]; left: string[] }> {
  const copied: string[] = [];
  const left: string[] = [];
  const wanted = new Set<string>();
  const collect = (from: Graph): void => {
    for (const node of from.nodes) {
      const element = registry.node(node.node_type);
      for (const path of element?.referencedPaths(node) ?? []) wanted.add(path);
      const held = element?.nestedGraph(node);
      // A file an inner node reads is a file the bundle must carry, and its
      // path is relative to the same project folder.
      if (held) collect(held);
    }
  };
  collect(graph);
  for (const path of wanted) {
    const tidy = normalize(path);
    const source = resolve(from, tidy);
    if (isAbsolute(path) || tidy.split(sep).includes('..') || !existsSync(source)) { left.push(path); continue; }
    if (await sizeOf(source) > DATA_LIMIT_BYTES) { left.push(path); continue; }
    await mkdir(dirname(resolve(target, tidy)), { recursive: true });
    await cp(source, resolve(target, tidy), { recursive: true });
    copied.push(tidy.replace(/\\/g, '/'));
  }
  return { copied, left };
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
  options: { name?: string; pageDir?: string; dataFrom?: string } = {},
): Promise<string[]> {
  // A bundle is something handed to someone else. One of a graph with no nodes
  // is a zip that starts, does nothing and says nothing -- and the person who
  // opens it has no way to tell that from a tool that failed.
  if (!graph.nodes.length) throw new Error('This graph has no nodes: there is nothing to hand over.');
  const needs = bundleNeeds(graph);
  const name = options.name || graph.metadata.name || 'graph';
  const written: string[] = [];

  const put = async (relativePath: string, content: string): Promise<void> => {
    const path = resolve(target, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    written.push(relativePath);
  };

  await put('graph.json', `${JSON.stringify(graph, null, 2)}\n`);

  for (const file of await engineFiles()) {
    const relativePath = join('engine', relative(ENGINE_ROOT, file)).replace(/\\/g, '/');
    const path = resolve(target, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(file, path);
    written.push(relativePath);
  }

  // The page, if this graph has one and a build is at hand. A bundle without
  // it still runs -- on the terminal, asking for what the blocks would have
  // asked for -- which is why a missing build is not an error here.
  let servesPage = false;
  if (needs.interface && options.pageDir) {
    for (const file of await pageFiles(options.pageDir)) {
      const relativePath = join('page', file).replace(/\\/g, '/');
      const path = resolve(target, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await copyFile(join(options.pageDir, file), path);
      written.push(relativePath);
      servesPage = true;
    }
  }

  const data = await dataFiles(graph, options.dataFrom ?? process.cwd(), target);
  written.push(...data.copied);

  // From its own folder, wherever it was started from: the graph's paths are
  // relative to the bundle, and a double-click starts in whatever folder the
  // shell felt like.
  const command = servesPage ? 'engine/main.ts graph.json --serve' : 'engine/main.ts graph.json';
  await put('run.cmd', ['@echo off', 'cd /d "%~dp0"', `node ${command.replace(/\//g, '\\')} %*`, ''].join('\r\n'));
  await put('run.sh', ['#!/bin/sh', 'cd "$(dirname "$0")" || exit 1', `exec node ${command} "$@"`, ''].join('\n'));
  await put('README.md', readme(name, needs, servesPage, data));

  return written;
}

function readme(
  name: string, needs: BundleNeeds, servesPage = false,
  data: { copied: string[]; left: string[] } = { copied: [], left: [] },
): string {
  const lines = [
    `# ${name}`,
    '',
    'A graph, and the engine that runs it. Nothing here was generated: the',
    'engine is a verbatim copy of the one the graph was built and tested on, so',
    'this runs what was tested rather than a second implementation of it.',
    '',
    '## Running it',
    '',
    '```',
    './run.sh          # or run.cmd on Windows',
    '```',
    '',
    ...(servesPage
      ? [
        'That opens the tool in your browser: fill in the fields, press Run.',
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
    '- **Node 22 or newer.** Nothing to install and nothing to build.',
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
      '## The interface',
      '',
      'This graph has a page. Running it from the command line works and fills',
      "the page's blocks with values, but does not draw them; the fields it",
      'would otherwise ask you to fill are asked for on the terminal instead.',
    );
  }

  if (data.copied.length || data.left.length) {
    lines.push('', '## Its files', '');
    if (data.copied.length) {
      lines.push(
        'The files this graph starts on came with it, in the same relative place',
        'they had where it was built:', '',
        ...data.copied.map((path) => `- \`${path}\``),
      );
    }
    if (data.left.length) {
      lines.push(
        '', 'These it names but does not carry -- an absolute path is a place on',
        "somebody else's machine, and anything over 50 MB is yours to bring. Choose",
        'your own in the tool, or pass `--inputs`:', '',
        ...data.left.map((path) => `- \`${path}\``),
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
