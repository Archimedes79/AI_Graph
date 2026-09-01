import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseGraph } from './graph.ts';
import { bundleNeeds, writeBundle } from './bundle.ts';

/**
 * A bundle is only a claim until someone runs it somewhere else.
 *
 * So this writes one into a temporary directory and runs the graph *from
 * there* — not from the repo — with the repo's own sources out of reach. That
 * is the difference between "the files were copied" and "it works".
 */

const REPO = resolve(__dirname, '..', '..');

function run(dir: string, args: string[] = []): Promise<{ code: number; out: string; err: string }> {
  return new Promise((fulfil, fail) => {
    const child = spawn(process.execPath, [join(dir, 'engine', 'main.ts'), join(dir, 'graph.json'), ...args], {
      cwd: dir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', fail);
    child.on('close', (code) => fulfil({ code: code ?? -1, out, err }));
  });
}

async function bundleOf(example: string): Promise<string> {
  const graph = parseGraph(JSON.parse(await readFile(resolve(REPO, 'examples', example), 'utf8')));
  const dir = await mkdtemp(join(tmpdir(), 'ai-graph-bundle-'));
  await writeBundle(graph, dir);
  return dir;
}

describe('a bundle', () => {
  it('runs the graph from somewhere else entirely', async () => {
    const dir = await bundleOf('plotter_interactive.json');
    try {
      const { code, out } = await run(dir);
      expect(code).toBe(0);
      const result = JSON.parse(out);
      expect(result.status).toBe('success');
      // Not merely "it started": the chart node produced its points.
      const panel = result.node_results.find((n: { node_id: string }) => n.node_id === 'panel');
      expect(Array.isArray(panel.inputs.chart_in)).toBe(true);
      expect(panel.inputs.chart_in.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('carries no tests, because a recipient has nothing to compare against', async () => {
    const dir = await bundleOf('hello_world.json');
    try {
      const { code, out } = await run(dir);
      expect(code).toBe(0);
      expect(JSON.parse(out).status).toBe('success');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('carries the page, and only what the page references', async () => {
    // The editor's own chunks sit in the same build folder. A bundle that
    // copied the folder would hand the graph editor to someone who was handed
    // a finished tool, so the file list comes out of runtime.html itself.
    const graph = parseGraph(JSON.parse(
      await readFile(resolve(REPO, 'examples/plotter_interactive.json'), 'utf8'),
    ));
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-page-bundle-'));
    try {
      const written = await writeBundle(graph, dir, { pageDir: resolve(REPO, 'frontend/dist') });
      const page = written.filter((p) => p.startsWith('page/'));
      expect(page).toContain('page/runtime.html');
      expect(page.some((p) => p.endsWith('.js'))).toBe(true);
      // run.sh serves, because there is something to serve.
      expect(await readFile(join(dir, 'run.sh'), 'utf8')).toContain('--serve');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('says what has to be installed, and no more than that', async () => {
    const plotter = parseGraph(JSON.parse(
      await readFile(resolve(REPO, 'examples/plotter_interactive.json'), 'utf8'),
    ));
    const hello = parseGraph(JSON.parse(
      await readFile(resolve(REPO, 'examples/hello_world.json'), 'utf8'),
    ));

    // The plotter has a page, so a bundle without one would be half of it.
    expect(bundleNeeds(plotter).interface).toBe(true);
    // Hello world is two nodes, no page and no model: Node and nothing else.
    expect(bundleNeeds(hello)).toEqual({ interface: false, ai: false });
  });

  it('writes a README that names the model settings only when one is asked', async () => {
    const dir = await bundleOf('plotter_interactive.json');
    try {
      const readme = await readFile(join(dir, 'README.md'), 'utf8');
      expect(readme).toContain('Node 22 or newer');
      // The one thing a recipient has to be told, and now the only one: the
      // interpreter that runs the engine runs every body in the graph too.
      expect(readme).toContain('Nothing else');
      // The plotter asks no model, so a page of provider settings would be
      // instructions for something that never happens.
      expect(readme).not.toContain('AI_GRAPH_AI_PROVIDER');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
