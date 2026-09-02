import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { serve } from './serve.ts';

/**
 * The endpoints a deployed page calls, and the two rules about them.
 *
 * The shapes are not this server's to choose: `RunSnapshot` in the page's own
 * client declares them, and a snapshot missing `done` looks to the page exactly
 * like a run that never finishes — which is how it first behaved. Reading the
 * contract rather than inventing it is the whole lesson of this port.
 *
 * The second rule is what is *absent*. A deployed tool must not offer code
 * generation or graph editing; those routes are not "not implemented yet", they
 * are the boundary, and a test is the only thing that keeps a boundary from
 * being widened by someone being helpful.
 */

const REPO = resolve(__dirname, '..', '..', '..');
const started: Server[] = [];

afterAll(() => { for (const server of started) server.close(); });

async function serveGraph(name = 'hello_world.json', pageDir?: string) {
  const graphPath = resolve(REPO, 'examples', name);
  const { server, url } = await serve({ graphPath, pageDir, port: 0 });
  started.push(server);
  return { url, graph: JSON.parse(await readFile(graphPath, 'utf8')) };
}

const asJson = (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('what a deployed tool serves', () => {
  it('hands over the graph it ships', async () => {
    const { url } = await serveGraph();
    const graph = await asJson(await fetch(`${url}/api/runtime/graph`));
    expect((graph.metadata as { name: string }).name).toBeTruthy();
    expect(Array.isArray(graph.nodes)).toBe(true);
  });

  it('runs it, in one call, for anything driving it over HTTP', async () => {
    const { url, graph } = await serveGraph();
    const result = await asJson(await fetch(`${url}/api/execute/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graph),
    }));
    expect(result.status).toBe('success');
  }, 60_000);

  it('runs it watchably, in the shape the page reads', async () => {
    const { url, graph } = await serveGraph();
    const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graph) };
    const { run_id: runId, total } = await asJson(await fetch(`${url}/api/execute/start`, post)) as
      { run_id: string; total: number };

    expect(typeof runId).toBe('string');
    expect(total).toBeGreaterThan(0);

    let snapshot: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 60; attempt += 1) {
      snapshot = await asJson(await fetch(`${url}/api/execute/runs/${runId}`));
      if (snapshot.done) break;
      await new Promise((wait) => setTimeout(wait, 100));
    }

    // Every field the page's `RunSnapshot` declares. A missing one is not a
    // cosmetic gap: `done` is how the page knows to stop polling.
    expect(snapshot).toMatchObject({
      run_id: runId,
      done: true,
      cancelled: false,
      total,
      error: null,
    });
    expect(snapshot).toHaveProperty('running');
    expect(snapshot).toHaveProperty('current_label');
    expect(snapshot).toHaveProperty('item_done');
    expect(snapshot).toHaveProperty('item_total');
    expect(snapshot).toHaveProperty('idle_seconds');
    expect((snapshot.result as { status: string }).status).toBe('success');
  }, 60_000);

  it('offers nothing a deployed tool has no business offering', async () => {
    // Not "not implemented": these are the boundary. Code generation and graph
    // editing belong to building one, not to running one.
    const { url } = await serveGraph();
    for (const path of ['/api/ai/generate', '/api/graphs/file/save', '/api/nodes/code/run']) {
      const response = await fetch(`${url}${path}`, { method: 'POST' });
      expect(response.status).toBe(404);
    }
  });
});

describe('the page it serves', () => {
  it('serves the built page, and the same page for a deep link', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-page-'));
    try {
      await mkdir(join(dir, 'assets'), { recursive: true });
      await writeFile(join(dir, 'runtime.html'), '<!doctype html><title>tool</title>');
      await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');

      const { url } = await serveGraph('hello_world.json', dir);

      expect(await (await fetch(`${url}/`)).text()).toContain('<title>tool</title>');
      expect(await (await fetch(`${url}/assets/app.js`)).text()).toBe('console.log(1)');
      // A single-page tool: a path that is not a file is still the tool.
      expect(await (await fetch(`${url}/anything`)).text()).toContain('<title>tool</title>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('will not serve its way out of the page directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-graph-page-'));
    try {
      await writeFile(join(dir, 'runtime.html'), '<!doctype html><title>tool</title>');
      const { url } = await serveGraph('hello_world.json', dir);
      // Whatever this resolves to, it must not be a file from above the page.
      const escaped = await (await fetch(`${url}/../../graph.json`)).text();
      expect(escaped).toContain('<title>tool</title>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the engine as the front door of the editor', () => {
  /** A stand-in for the Python server: answers anything with what it was asked. */
  async function upstream(): Promise<string> {
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ path: request.url, method: request.method, body }));
      });
    });
    started.push(server);
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  async function editor(api?: string) {
    const dist = await mkdtemp(join(tmpdir(), 'editor-dist-'));
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>the editor</title>');
    const { server, url } = await serve({ port: 0, editor: { dist, api: api ?? await upstream() } });
    started.push(server);
    return url;
  }

  it('serves the editor page, and that page for any deep link', async () => {
    const url = await editor();
    expect(await (await fetch(`${url}/`)).text()).toContain('the editor');
    expect(await (await fetch(`${url}/some/route`)).text()).toContain('the editor');
  });

  it('forwards a route it does not own yet, body and all', async () => {
    const url = await editor();
    const reply = await asJson(await fetch(`${url}/api/ai/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"element":"code"}',
    }));
    expect(reply).toEqual({ path: '/api/ai/generate', method: 'POST', body: '{"element":"code"}' });
  });

  it('answers what it owns itself, without asking anyone', async () => {
    const url = await editor('http://127.0.0.1:1');   // nobody there: owned routes must not care
    const graph = JSON.parse(await readFile(resolve(REPO, 'examples', 'hello_world.json'), 'utf8'));
    const requirements = await (await fetch(`${url}/api/execute/requirements`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graph),
    })).json();
    expect(Array.isArray(requirements)).toBe(true);
  });

  it('says so, rather than hanging, when the other server is gone', async () => {
    const url = await editor('http://127.0.0.1:1');
    expect((await fetch(`${url}/api/anything`)).status).toBe(502);
  });
});
