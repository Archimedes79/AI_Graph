import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGraph, type Graph } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { startClock } from './clock.ts';
import type { Trigger } from './triggers.ts';

// The one clock every host keeps a tool's time with: the server's schedule
// and the editor's ▶ Run. Its timing is held in host/schedule.test.ts too,
// through the server; here what only the clock itself decides.

const trigger = (id: string, config: Record<string, unknown>) => ({ id, node_type: 'trigger', label: id, config });
const graphOf = (...nodes: unknown[]): Graph => parseGraph({ metadata: { name: 'Clock' }, nodes, edges: [] });

let fired: string[];
const round = async (event: Trigger) => { fired.push(event.node_id); };

beforeEach(() => { fired = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('a tool\'s clock', () => {
  it('fires at start what starting runs, and settles `started` once those rounds have run', async () => {
    let graph = graphOf(trigger('start', {}), trigger('later', { trigger_on_start: false, trigger_every: '1m' }));
    const clock = startClock(() => graph, registry, round);
    await clock.started;
    expect(fired).toEqual(['start']);
    expect(clock.runsByItself).toBe(true);
    expect(clock.ticks).toBe(true);
    expect(clock.nextAt()).not.toBeNull();
    await clock.stop();
    graph = graphOf();
  });

  it('looks a trigger up each time it is due: deleted, its clock stops; its interval changed, the new one counts', async () => {
    let graph = graphOf(trigger('a', { trigger_on_start: false, trigger_every: '10s' }), trigger('b', { trigger_on_start: false, trigger_every: '10s' }));
    const clock = startClock(() => graph, registry, round);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fired).toEqual(['a', 'b']);
    graph = graphOf(trigger('b', { trigger_on_start: false, trigger_every: '30s' }));
    await vi.advanceTimersByTimeAsync(10_000);
    // b ran on the interval it had when it was wound; a is gone and fired no round.
    expect(fired).toEqual(['a', 'b', 'b']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fired).toEqual(['a', 'b', 'b']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fired).toEqual(['a', 'b', 'b', 'b']);
    await clock.stop();
  });

  it('goes on after a round that throws: what failed is the host\'s to say', async () => {
    const graph = graphOf(trigger('tick', { trigger_on_start: false, trigger_every: '5s' }));
    let calls = 0;
    const clock = startClock(() => graph, registry, async () => {
      calls += 1;
      if (calls === 1) throw new Error('not this time');
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(2);
    await clock.stop();
  });

  it('says an interval nobody can read, keeps no time for it, and runs nothing by itself for it', () => {
    const clock = startClock(() => graphOf(trigger('odd', { trigger_on_start: false, trigger_every: 'sometimes' })), registry, round);
    expect(clock.problem()).toMatch(/Not an interval: sometimes/);
    expect(clock.ticks).toBe(false);
    expect(clock.runsByItself).toBe(false);
    void clock.stop();
  });

  it('starts no round once stopped, and settles when the one in flight has ended', async () => {
    const graph = graphOf(trigger('slow', { trigger_every: '1s' }));
    let finish: () => void = () => {};
    const clock = startClock(() => graph, registry, (event) => new Promise<void>((resolve) => {
      fired.push(event.node_id);
      finish = resolve;
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fired).toEqual(['slow']);
    let settled = false;
    const stopped = clock.stop().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    finish();
    await stopped;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fired).toEqual(['slow']);
  });
});
