import { describe, it, expect } from 'vitest';
import type { ExecutionResult } from '../graph.ts';
import { Rounds, type RoundWork } from './rounds.ts';

const wait = (ms: number) => new Promise((wake) => setTimeout(wake, ms));
const done = (status: ExecutionResult['status'] = 'success'): ExecutionResult => ({ status, node_results: [], outputs: {} });
const named = (id: string) => id;

describe('Rounds', () => {
  it('runs one round after the other, in the order they were asked for', async () => {
    const rounds = new Rounds();
    const seen: string[] = [];
    const round = (label: string, ms: number) => rounds.start(1, named, async () => {
      seen.push(`${label} starts`);
      await wait(ms);
      seen.push(`${label} ends`);
      return done();
    }).outcome;
    await Promise.all([round('first', 40), round('second', 5)]);
    expect(seen).toEqual(['first starts', 'first ends', 'second starts', 'second ends']);
  });

  it('says a round waits while the one before it runs, and how far a running one is', async () => {
    const rounds = new Rounds();
    let release = (): void => {};
    let told: RoundWork | null = null;
    const first = rounds.start(3, (node) => `Node ${node}`, (work) => {
      told = work;
      return new Promise((ended) => { release = () => ended(done()); });
    });
    const second = rounds.start(1, named, async () => done());
    await wait(10);
    expect(rounds.snapshot(second.id)).toMatchObject({ done: false, current_label: 'Waiting for the round before it' });
    told!.report({ type: 'node_start', node_id: 'a' });
    told!.report({ type: 'batch', node_id: 'a', done: 2, total: 5 });
    told!.report({ type: 'node_done', node_id: 'a', status: 'success' });
    expect(rounds.snapshot(first.id)).toMatchObject({ completed: 1, total: 3, current_label: 'Node a', item_done: 2, item_total: 5 });
    release();
    await second.outcome;
    expect(rounds.snapshot(first.id)).toMatchObject({ done: true, cancelled: false, error: null, result: { status: 'success' } });
  });

  it('goes on after a round that could not run, and says why it could not', async () => {
    const rounds = new Rounds();
    const failed = rounds.start(1, named, async () => { throw new Error('Graph contains a cycle'); });
    await expect(failed.outcome).rejects.toThrow('cycle');
    await wait(0);
    expect(rounds.snapshot(failed.id)).toMatchObject({ done: true, error: 'Graph contains a cycle', result: null });
    expect(await rounds.start(1, named, async () => done()).outcome).toMatchObject({ status: 'success' });
  });

  it('lets a round stopped while it waits go at once, and the next in line still wait for the one ahead', async () => {
    const rounds = new Rounds();
    let release = (): void => {};
    const ahead = rounds.start(1, named, () => new Promise((ended) => { release = () => ended(done()); }));
    const stop = new AbortController();
    const seen: string[] = [];
    const stopped = rounds.start(1, named, async () => { seen.push('stopped'); return done(); }, stop.signal);
    const next = rounds.start(1, named, async () => { seen.push('next'); return done(); });
    stop.abort();
    await expect(stopped.outcome).rejects.toThrow('Stopped.');
    await wait(20);
    expect(rounds.snapshot(stopped.id)).toMatchObject({ done: true, cancelled: true });
    expect(seen).toEqual([]);
    release();
    await Promise.all([ahead.outcome, next.outcome]);
    expect(seen).toEqual(['next']);
  });

  it('stops a round in flight through the signal it handed the work, and stops everything still going at once', async () => {
    const rounds = new Rounds();
    const work = (round: RoundWork) => new Promise<ExecutionResult>((ended) => {
      round.signal.addEventListener('abort', () => ended(done('cancelled')));
    });
    const first = rounds.start(1, named, work);
    const second = rounds.start(1, named, work);
    await wait(10);
    expect(await rounds.stopAll()).toBe(2);
    expect(rounds.snapshot(first.id)).toMatchObject({ done: true, cancelled: true, result: { status: 'cancelled' } });
    expect(rounds.snapshot(second.id)).toMatchObject({ done: true, cancelled: true });
    expect(await rounds.stopAll()).toBe(0);
    expect(rounds.stop('no such round')).toBe(false);
  });

  it('runs what must have the session to itself between the rounds before and after it', async () => {
    const rounds = new Rounds();
    const seen: string[] = [];
    let release = (): void => {};
    const ahead = rounds.start(1, named, () => new Promise((ended) => { release = () => { seen.push('round before'); ended(done()); }; }));
    const alone = rounds.exclusive(async () => { seen.push('alone'); });
    const after = rounds.start(1, named, async () => { seen.push('round after'); return done(); });
    await wait(10);
    release();
    await Promise.all([ahead.outcome, alone, after.outcome]);
    expect(seen).toEqual(['round before', 'alone', 'round after']);
  });
});
