import { describe, it, expect } from 'vitest';
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
    const clock = schedule(() => graphWith({ every: '0.06' }), async () => { runs += 1; return done(); });
    expect(clock.state().next_at).not.toBeNull();
    await wait(20);
    expect(runs).toBe(0);
    await wait(90);
    expect(runs).toBe(1);
    clock.stop();
  });

  it('survives a round that could not run, and tries the next', async () => {
    let rounds = 0;
    const clock = schedule(() => graphWith({ on_start: true, every: '0.03' }), async () => {
      rounds += 1;
      if (rounds === 1) throw new Error('Graph contains a cycle');
      return done();
    });
    await wait(20);
    expect(clock.state()).toMatchObject({ error: 'Graph contains a cycle', result: null });
    await wait(80);
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

  it('reports an interval nobody can read instead of running on a guess', () => {
    const clock = schedule(() => graphWith({ every: 'soon' }), async () => done());
    expect(clock.state()).toMatchObject({ scheduled: false, error: expect.stringMatching(/Not an interval/) });
    clock.stop();
  });
});
