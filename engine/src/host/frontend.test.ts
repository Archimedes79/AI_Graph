import { describe, it, expect, afterAll } from 'vitest';
import { cp, mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve, type Served } from './serve.ts';
import { API } from './api.ts';
import { loadGraph, frontendOf } from '../project/folder.ts';
import { writeBundle } from '../cli/bundle.ts';

/**
 * A page of a project's own, written by hand against the runtime API: served
 * in place of the built page, carried by a bundle -- and, in the example that
 * has one, calling nothing but what any frontend may call.
 */

const EXAMPLE = resolve(__dirname, '..', '..', '..', 'examples', 'nested_statistics');
const served: Served[] = [];
afterAll(async () => { for (const one of served) await one.shutdown(); });

/** A copy of the example: a served project keeps its state beside its flow.json. */
async function example(): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'frontend-')), 'nested_statistics');
  await cp(EXAMPLE, dir, { recursive: true });
  return dir;
}

describe('a project\'s own frontend', () => {
  it('is served at / and beside it, in place of the built page', async () => {
    const dir = await example();
    await writeFile(join(dir, 'frontend', 'style.css'), 'body { color: red }');
    const pageDir = await mkdtemp(join(tmpdir(), 'built-'));
    await writeFile(join(pageDir, 'runtime.html'), '<title>built</title>');
    const one = await serve({ graphPath: dir, pageDir, port: 0 });
    served.push(one);
    expect(await (await fetch(`${one.url}/`)).text()).toContain('<title>Nested statistics</title>');
    expect(await (await fetch(`${one.url}/style.css`)).text()).toBe('body { color: red }');
  });

  it('is a folder with an index.html in it, in a project: anything less is no page of its own', async () => {
    const dir = await example();
    expect(frontendOf(dir)).toBe(join(dir, 'frontend'));
    // The project a node holds has none; nor has a folder whose page is not there yet.
    expect(frontendOf(join(dir, 'nodes', 'statistics'))).toBeNull();
    await mkdir(join(dir, 'nodes', 'statistics', 'frontend'));
    expect(frontendOf(join(dir, 'nodes', 'statistics'))).toBeNull();
  });

  it('in the example, calls nothing but the runtime API any frontend may call', async () => {
    const page = await readFile(join(EXAMPLE, 'frontend', 'index.html'), 'utf8');
    const called = new Set([
      ...[...page.matchAll(/\bapi\('([a-z]+)'/g)].map((match) => `/api/runtime/${match[1]}`),
      ...[...page.matchAll(/`?(\/api\/[a-z/]+)/g)].map((match) => match[1].replace(/\/$/, '')).filter((path) => path !== '/api/runtime'),
    ]);
    expect(called.size).toBeGreaterThan(2);
    const tool = Object.values(API).filter((route) => route.for === 'tool' && route.path.startsWith('/api/runtime/')).map((route) => route.path);
    for (const path of called) expect(tool, path).toContain(path);
  });

  it('runs the example by name: the paragraph in, the report out', async () => {
    const dir = await example();
    const one = await serve({ graphPath: dir, port: 0 });
    served.push(one);
    const graph = await (await fetch(`${one.url}/api/runtime/interface`)).json() as { values: { name: string }[]; outputs: { name: string }[]; events: unknown[] };
    expect(graph.values.map((value) => value.name)).toEqual(['paragraph']);
    expect(graph.outputs.map((output) => output.name)).toEqual(['report']);
    expect(graph.events).toEqual([]);
    const ran = await (await fetch(`${one.url}/api/runtime/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { paragraph: 'One two three. Four five.' } }),
    })).json() as { status: string; outputs: { report?: unknown } };
    expect(ran.status).toBe('success');
    expect(ran.outputs.report).toBeTruthy();
  }, 60_000);

  it('goes with a bundle, which serves it', async () => {
    const dir = await example();
    const target = await mkdtemp(join(tmpdir(), 'bundle-'));
    const written = await writeBundle((await loadGraph(dir)), target, { frontend: frontendOf(dir), dataFrom: dir });
    expect(written).toContain('frontend/index.html');
    expect(await readFile(join(target, 'run.sh'), 'utf8')).toContain('--serve');
    expect(frontendOf(target)).toBe(join(target, 'frontend'));
  });
});
