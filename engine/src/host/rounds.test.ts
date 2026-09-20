import { describe, it, expect } from 'vitest';
import { parseGraph } from '../graph.ts';
import { Rounds } from './rounds.ts';
import { RunBoard } from './runs.ts';

const wait = (ms: number) => new Promise((wake) => setTimeout(wake, ms));
const named = (name: string) => parseGraph({ metadata: { name }, nodes: [], edges: [] });

describe('Rounds', () => {
  it('runs the rounds of one graph one after the other, in the order asked', async () => {
    const rounds = new Rounds();
    const seen: string[] = [];
    const round = (label: string, ms: number) => rounds.turn(named('a'), async () => {
      seen.push(`${label} starts`);
      await wait(ms);
      seen.push(`${label} ends`);
      return label;
    });
    expect(await Promise.all([round('first', 40), round('second', 5)])).toEqual(['first', 'second']);
    expect(seen).toEqual(['first starts', 'first ends', 'second starts', 'second ends']);
  });

  it('does not make one graph wait for another', async () => {
    const rounds = new Rounds();
    const seen: string[] = [];
    await Promise.all([
      rounds.turn(named('slow'), async () => { await wait(40); seen.push('slow'); }),
      rounds.turn(named('quick'), async () => { seen.push('quick'); }),
    ]);
    expect(seen).toEqual(['quick', 'slow']);
  });

  it('goes on after a round that failed', async () => {
    const rounds = new Rounds();
    await expect(rounds.turn(named('a'), async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(await rounds.turn(named('a'), async () => 'next')).toBe('next');
  });
});

describe('RunBoard', () => {
  it('queues two events on one graph instead of running them into each other', async () => {
    const SLOW = 'async function run() { await new Promise((r) => setTimeout(r, 300)); return { out: Date.now() }; }';
    const graph = () => parseGraph({
      metadata: { name: 'queued' },
      nodes: [{ id: 'slow', node_type: 'code', inputs: [], outputs: [{ id: 'out', name: 'out' }], config: { code: SLOW } }],
      edges: [],
    });
    const runs = new RunBoard();
    const first = runs.start(graph(), null, 1);
    const second = runs.start(graph(), null, 1);
    expect(runs.snapshot(second)).toMatchObject({ done: false, current_label: 'Waiting for the round before it' });
    for (let i = 0; i < 100 && !runs.snapshot(second)?.done; i += 1) await wait(100);
    const ended = (id: string) => Number((runs.snapshot(id)!.result!.node_results[0].outputs as { out: number }).out);
    expect(ended(second) - ended(first)).toBeGreaterThanOrEqual(250);
  }, 30_000);
});
