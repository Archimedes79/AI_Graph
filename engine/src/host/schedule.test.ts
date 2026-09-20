import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGraph, type ExecutionResult, type Graph } from '../graph.ts';
import { schedule } from './schedule.ts';

const graphWith = (triggers: Record<string, unknown>): Graph =>
  parseGraph({ metadata: { name: 't', triggers }, nodes: [], edges: [] });

const done = (): ExecutionResult => ({ status: 'success', node_results: [], outputs: {} });
const wait = (ms: number) => new Promise((wake) => setTimeout(wake, ms));

describe('schedule', () => {
  it('does nothing for a graph that names no trigger, and says so', async () => {
    let runs = 0;
    const clock = schedule(() => graphWith({}), async () => { runs += 1; return done(); });
    await wait(30);
    expect(runs).toBe(0);
    expect(clock.state()).toMatchObject({ scheduled: false, runs: 0, next_at: null });
    clock.stop();
  });

  it('runs once at start, and keeps the result for whoever asks later', async () => {
    const clock = schedule(() => graphWith({ on_start: true }), async () => done());
    await wait(30);
    expect(clock.state()).toMatchObject({ scheduled: true, runs: 1, running: false, result: { status: 'success' }, next_at: null });
    clock.stop();
  });

  it('runs again after the interval, counted from the end of the run before', async () => {
    const starts: number[] = [];
    const clock = schedule(() => graphWith({ on_start: true, every: '0.05' }), async () => {
      starts.push(Date.now());
      await wait(80);                       // slower than its own interval
      return done();
    });
    await wait(330);
    clock.stop();
    expect(starts.length).toBeGreaterThanOrEqual(2);
    // Never overtaken: each start is at least run + interval after the last.
    for (let i = 1; i < starts.length; i += 1) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(120);
  });

  it('waits one interval before the first run when nothing says "at start"', async () => {
    let runs = 0;
    // Wide margins: the second round is due at 0.6 s, so a busy machine that
    // checks late still finds exactly one.
    const clock = schedule(() => graphWith({ every: '0.3' }), async () => { runs += 1; return done(); });
    expect(clock.state().next_at).not.toBeNull();
    await wait(60);
    expect(runs).toBe(0);
    await wait(360);
    expect(runs).toBe(1);
    clock.stop();
  });

  it('survives a round that could not run, and tries the next', async () => {
    let rounds = 0;
    const clock = schedule(() => graphWith({ on_start: true, every: '0.3' }), async () => {
      rounds += 1;
      if (rounds === 1) throw new Error('Graph contains a cycle');
      return done();
    });
    await wait(60);
    expect(clock.state()).toMatchObject({ error: 'Graph contains a cycle', result: null });
    await wait(400);
    clock.stop();
    expect(clock.state()).toMatchObject({ error: null, result: { status: 'success' } });
  });

  it('stops: no round starts afterwards, and the one in flight is told', async () => {
    let told = false;
    let runs = 0;
    const clock = schedule(() => graphWith({ on_start: true, every: '0.02' }), async (_graph, signal) => {
      runs += 1;
      signal.addEventListener('abort', () => { told = true; });
      await wait(40);
      return done();
    });
    await wait(10);
    clock.stop();
    await wait(120);
    expect(told).toBe(true);
    expect(runs).toBe(1);
  });

  it('keeps the last round on disk, and a restarted server shows it before its next run', async () => {
    const kept = join(mkdtempSync(join(tmpdir(), 'schedule-')), 'tool.json.last-run.json');
    const first = schedule(() => graphWith({ on_start: true }), async () => done(), kept);
    await wait(30);
    first.stop();

    // Every 10 s: nothing runs during this test, so what it shows can only be what was kept.
    const second = schedule(() => graphWith({ every: '10' }), async () => done(), kept);
    expect(second.state()).toMatchObject({ runs: 1, running: false, result: { status: 'success' } });
    expect(second.state().finished_at).not.toBeNull();
    second.stop();
  });

  it('starts empty when the kept file is missing or unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'schedule-'));
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    for (const path of [join(dir, 'absent.json'), join(dir, 'broken.json')]) {
      const clock = schedule(() => graphWith({ every: '10' }), async () => done(), path);
      expect(clock.state()).toMatchObject({ runs: 0, result: null });
      clock.stop();
    }
  });

  it('reports an interval nobody can read instead of running on a guess', () => {
    const clock = schedule(() => graphWith({ every: 'soon' }), async () => done());
    expect(clock.state()).toMatchObject({ scheduled: false, error: expect.stringMatching(/Not an interval/) });
    clock.stop();
  });
});

describe('trigger nodes', () => {
  const clocks = (nodes: Record<string, unknown>[]): Graph => parseGraph({
    metadata: { name: 'clocks' },
    nodes: nodes.map((config, index) => ({ id: `t${index}`, node_type: 'trigger', config })),
    edges: [],
  });

  it('tells each round which trigger began it', async () => {
    const began: string[] = [];
    const clock = schedule(() => clocks([{ trigger_on_start: true }, { trigger_on_start: false, trigger_every: '0.05' }]),
      async (_graph, _signal, event) => { began.push(event.node_id); return done(); });
    await wait(200);
    clock.stop();
    expect(began[0]).toBe('t0');
    expect(began.filter((id) => id === 't0')).toHaveLength(1);          // at start, once
    expect(began.filter((id) => id === 't1').length).toBeGreaterThanOrEqual(1);
  });

  it('never runs two rounds at once, however many clocks are due', async () => {
    let inside = 0;
    let most = 0;
    const clock = schedule(() => clocks([{ trigger_every: '0.02', trigger_on_start: true }, { trigger_every: '0.02', trigger_on_start: true }]),
      async () => { inside += 1; most = Math.max(most, inside); await wait(30); inside -= 1; return done(); });
    await wait(250);
    await clock.stop();
    expect(most).toBe(1);
  });

  it('keeps what an earlier round showed when a later one touched something else', async () => {
    const clock = schedule(() => clocks([{ trigger_on_start: true }, { trigger_on_start: true }]),
      async (_graph, _signal, event) => ({
        status: 'success', outputs: {},
        node_results: [{ node_id: `made-by-${event.node_id}`, status: 'success', inputs: {}, outputs: {} }],
      }));
    await wait(60);
    clock.stop();
    expect(clock.state().result!.node_results.map((r) => r.node_id)).toEqual(['made-by-t0', 'made-by-t1']);
  });
});
