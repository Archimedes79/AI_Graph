// Handing the graph to someone else.
//
// A bundle is the graph, the engine that runs it, and one command. Nothing is
// generated: the engine files are copied verbatim, so what a recipient runs is
// what was tested here, byte for byte. Code generation would produce a second
// implementation that is right on the day it is written and drifts from that
// afternoon on — the reason the older bundles vendor their engine too.
//
// What a recipient needs installed: Node, and Python only if a code node in
// this graph is written in Python. That is the whole list.

import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Graph } from './graph.ts';
import { registry } from './registry.ts';

const ENGINE_ROOT = dirname(fileURLToPath(import.meta.url));

/** What this particular graph needs to run somewhere else. */
export interface BundleNeeds {
  /** Python packages its code nodes declared. */
  requirements: string[];
  /** Any Python at all: false means Node is the only thing to install. */
  python: boolean;
  /** The graph has an interface, so a bundle without a page is only half of it. */
  interface: boolean;
  /** It asks a model, so the recipient needs a provider configured. */
  ai: boolean;
}

export function bundleNeeds(graph: Graph): BundleNeeds {
  const needs: BundleNeeds = { requirements: [], python: false, interface: false, ai: false };

  for (const node of graph.nodes) {
    const element = registry.node(node.node_type);
    if (!element) continue;

    const declared = element.deployNeeds(node);
    needs.requirements.push(...declared.requirements);
    if (declared.needsInterface) needs.interface = true;
    if (node.node_type === 'ai') needs.ai = true;
    // A body's language is what decides whether Python is needed at all, and
    // it is the one thing a recipient cannot work around.
    if (node.node_type === 'code' && !String(node.config.language ?? 'python').startsWith('js')) {
      needs.python = true;
    }
  }

  needs.requirements = [...new Set(needs.requirements)].sort();
  return needs;
}

/** Every engine source file, so the copy is complete without a list to maintain. */
async function engineFiles(dir = ENGINE_ROOT): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await engineFiles(full));
    // Tests stay behind: a recipient runs the graph, and the differential test
    // would fail on their machine for want of a Python engine to compare with.
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
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
  options: { name?: string } = {},
): Promise<string[]> {
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

  await put('run.cmd', ['@echo off', 'node engine\\main.ts graph.json %*', ''].join('\r\n'));
  await put('run.sh', ['#!/bin/sh', 'exec node engine/main.ts graph.json "$@"', ''].join('\n'));
  if (needs.requirements.length) {
    await put('requirements.txt', `${needs.requirements.join('\n')}\n`);
  }
  await put('README.md', readme(name, needs));

  return written;
}

function readme(name: string, needs: BundleNeeds): string {
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
    './run.sh --every 5m   # again, after each run finishes',
    '```',
    '',
    'The result is printed as JSON on stdout; questions and progress go to',
    'stderr, so `./run.sh | jq` works.',
    '',
    '## What you need',
    '',
    '- **Node 22 or newer.** Nothing to install and nothing to build.',
  ];

  if (needs.python) {
    lines.push(
      '- **Python**, because a code node in this graph is written in it. Point',
      '  `AI_GRAPH_PYTHON` at an interpreter if `python3` is not on your PATH.',
    );
    if (needs.requirements.length) {
      lines.push(
        `- Those code nodes import: ${needs.requirements.join(', ')}.`,
        '  `pip install -r requirements.txt` into whichever interpreter you point at.',
      );
    }
  } else {
    lines.push('- Nothing else. No Python, no packages.');
  }

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

  lines.push('');
  return lines.join('\n');
}
