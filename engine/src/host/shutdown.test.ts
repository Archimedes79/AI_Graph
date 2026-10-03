import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './serve.ts';
import { Session } from './session.ts';
import { parseGraph } from '../graph.ts';

/**
 * Taking a server down with work in it.
 *
 * The real sandbox throughout: what has to be shown is that the child process
 * a run started is ended, not that a flag was set.
 */

const SLOW = 'async function run() { await new Promise((r) => setTimeout(r, 60000)); return { out: 1 }; }';
const port = (id: string) => ({ id, name: id });
const slowGraph = (trigger: { on_start?: boolean } = {}) => ({
  metadata: { name: 'slow' },
  nodes: [...(trigger.on_start ? [{ id: 'start', node_type: 'trigger', config: { trigger_on_start: true } }] : []), { id: 'slow', node_type: 'code', inputs: [], outputs: [port('out')], config: { code: SLOW } }],
  edges: [],
});
const wait = (ms: number) => new Promise((wake) => setTimeout(wake, ms));
const post = (url: string, body: unknown) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('Session.stopAll', () => {
  it('ends the round going and the one waiting, and waits until each has wound down', async () => {
    const session = await Session.open(parseGraph(slowGraph()));
    const first = session.start(null).id;
    const second = session.start(null).id;
    await wait(300);
    const began = Date.now();
    expect(await session.stopAll()).toBe(2);
    expect(Date.now() - began).toBeLessThan(10_000);
    expect(session.snapshot(first)).toMatchObject({ done: true, cancelled: true, result: { status: 'cancelled' } });
    // It never started: stopped where it waited, it has nothing to show.
    expect(session.snapshot(second)).toMatchObject({ done: true, cancelled: true, result: null });
    expect(await session.stopAll()).toBe(0);                       // nothing left to stop
  }, 30_000);
});

describe('shutting a server down', () => {
  it('ends the run a page started, refuses new work meanwhile, and closes', async () => {
    const { url, shutdown } = await serve({ port: 0 });
    const { run_id } = await (await post(`${url}/api/execute/start`, slowGraph())).json() as { run_id: string };
    await wait(300);

    const began = Date.now();
    const stopping = shutdown();
    // While the run winds down: a page may still look, nothing may start.
    const refused = await post(`${url}/api/execute/start`, slowGraph());
    expect(refused.status).toBe(503);
    const seen = await (await fetch(`${url}/api/execute/runs/${run_id}`)).json() as { cancelled: boolean };
    expect(seen.cancelled).toBe(true);
    // A page pressing Stop meanwhile is answered, not told the server is stopping.
    const stopped = await post(`${url}/api/execute/runs/${run_id}/cancel`, {});
    expect(stopped.status).toBe(200);

    expect(await stopping).toEqual([]);
    expect(Date.now() - began).toBeLessThan(10_000);
    await expect(fetch(`${url}/api/runtime/last`)).rejects.toThrow();
  }, 30_000);

  it('cuts a scheduled round off without writing it over the last one that finished', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shutdown-'));
    const graphPath = join(dir, 'graph.json');
    await writeFile(graphPath, JSON.stringify(slowGraph({ on_start: true })));
    const kept = `${graphPath}.last-run.json`;
    const before = JSON.stringify({ runs: 3, result: { status: 'success', node_results: [], outputs: {} }, error: null, finished_at: 1 });
    await writeFile(kept, before);

    const { url, shutdown } = await serve({ graphPath, port: 0 });
    await wait(300);
    expect(await (await fetch(`${url}/api/runtime/last`)).json()).toMatchObject({ running: true, runs: 3 });
    expect(await shutdown()).toEqual([]);
    expect(existsSync(kept)).toBe(true);
    expect(await readFile(kept, 'utf8')).toBe(before);
    // Nor does what the round began become the session's: it was not a round.
    expect(existsSync(`${graphPath}.state.json`)).toBe(false);
  }, 30_000);

  it('does not wait for a scheduled round queued behind a page\'s run: the clock stops first, the run after', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shutdown-'));
    const graphPath = join(dir, 'graph.json');
    const graph = { ...slowGraph(), nodes: [{ id: 'clock', node_type: 'trigger', config: { trigger_on_start: false, trigger_every: '0.2' } }, ...slowGraph().nodes] };
    await writeFile(graphPath, JSON.stringify(graph));
    const { url, shutdown } = await serve({ graphPath, port: 0 });
    await post(`${url}/api/execute/start`, graph);
    await wait(600);
    // The clock's round is due, and waits behind the page's.
    expect(await (await fetch(`${url}/api/runtime/last`)).json()).toMatchObject({ running: true });
    expect(await shutdown(4000)).toEqual([]);
  }, 30_000);
});
