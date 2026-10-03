// The rounds of one session: one at a time, watched while they go, stopped when asked.
//
// Two events on one page used to mean two runs at once: both read the graph as
// it was, both settled what they remembered, and whichever finished last was
// what the page kept. With outputs that stand between rounds (`latch.ts`) that
// stops being merely untidy -- a round would read what another is halfway
// through replacing. So the rounds of a session queue, in the order they were
// asked for, whoever asked: the page, the clock, a script.
//
// A round is started, reports as it goes, and is looked at by polling; Stop
// aborts it. That is a small state machine with one owner, so it is one class:
// the session hands it the work and asks it for snapshots, and nothing outside
// knows what a round's record holds.
//
// A round that is waiting can still be stopped, and then it ends at once
// rather than when the one ahead of it does. A shutdown counts on that: it
// stops the clock's round queued behind a page's before it stops the page's.

import type { ExecutionResult } from '../graph.ts';
import type { ProgressEvent } from '../elements/Runtime.ts';
import type { RunSnapshot } from './api.ts';

/** How long a finished round can still be looked at. A long session must not accumulate them. */
const KEEP_MS = 300_000;

/** What the work of a round is handed: where it says how far it is, and the signal Stop pulls. */
export interface RoundWork {
  report(event: ProgressEvent): void;
  signal: AbortSignal;
}

class Round {
  readonly id: string;
  readonly total: number;
  completed = 0;
  currentLabel = 'Waiting for the round before it';
  itemDone = 0;
  itemTotal = 0;
  lastActivity: number | null = null;
  result: ExecutionResult | null = null;
  error: string | null = null;
  cancelled = false;
  finishedAt: number | null = null;
  /** What Stop pulls: the executor ends the call in flight and starts nothing more. */
  readonly stop = new AbortController();
  /** Settles when the round has ended, however it ended: what a shutdown waits on. */
  ended: Promise<void> = Promise.resolve();

  constructor(id: string, total: number) {
    this.id = id;
    this.total = total;
  }

  report(event: ProgressEvent, labelOf: (nodeId: string) => string): void {
    this.lastActivity = Date.now();
    if (event.type === 'node_start') {
      this.currentLabel = labelOf(event.node_id);
      this.itemDone = 0;
      this.itemTotal = 0;
    }
    if (event.type === 'node_done') this.completed += 1;
    if (event.type === 'batch') {
      this.itemDone = event.done;
      this.itemTotal = event.total;
    }
  }

  halt(): void {
    this.cancelled = true;
    this.stop.abort();
  }

  snapshot(): RunSnapshot {
    return {
      run_id: this.id,
      done: this.finishedAt !== null,
      cancelled: this.cancelled,
      completed: this.completed,
      total: this.total,
      current_label: this.currentLabel,
      item_done: this.itemDone,
      item_total: this.itemTotal,
      idle_seconds: this.lastActivity === null ? null : (Date.now() - this.lastActivity) / 1000,
      error: this.error,
      result: this.result,
    };
  }
}

export class Rounds {
  /** Settles once every round asked for so far has ended: what the next one waits for. */
  private ahead: Promise<void> = Promise.resolve();
  private readonly kept = new Map<string, Round>();

  /**
   * Queue *work* as a round, and hand back its id at once -- and *outcome*,
   * what it produced once it has run, or why it could not run at all.
   *
   * `total` is how many nodes the round will touch -- all of them, or the
   * slice an event starts -- so the progress line reads "2 of 2", not "2 of 9
   * and done"; *labelOf* names a node on that line. *signal*, when given,
   * stops this round as Stop does: the clock's, which a shutdown pulls.
   */
  start(
    total: number,
    labelOf: (nodeId: string) => string,
    work: (round: RoundWork) => Promise<ExecutionResult>,
    signal?: AbortSignal,
  ): { id: string; outcome: Promise<ExecutionResult> } {
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const round = new Round(id, total);
    this.kept.set(id, round);
    const halt = (): void => round.halt();
    if (signal?.aborted) halt();
    signal?.addEventListener('abort', halt, { once: true });

    const before = this.ahead;
    const outcome = waited(before, round.stop.signal).then(() => {
      round.currentLabel = '';
      return work({ report: (event) => round.report(event, labelOf), signal: round.stop.signal });
    });
    // The next in line waits for this one to end, however it ends -- and for
    // the ones ahead of it, which a round stopped while it waited did not end.
    this.ahead = before.then(() => outcome).then(() => {}, () => {});
    round.ended = outcome
      .then((result) => { round.result = result; }, (error: unknown) => { round.error = error instanceof Error ? error.message : String(error); })
      .finally(() => {
        round.finishedAt = Date.now();
        signal?.removeEventListener('abort', halt);
        this.forgetOld();
      });
    return { id, outcome };
  }

  /** Run *work* once every round asked for before it has ended, and before any asked for after: a reset. */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const done = this.ahead.then(work);
    this.ahead = done.then(() => {}, () => {});
    return done;
  }

  snapshot(id: string): RunSnapshot | null {
    return this.kept.get(id)?.snapshot() ?? null;
  }

  /** Stop a round: the round is told, not just whoever was watching it. */
  stop(id: string): boolean {
    const round = this.kept.get(id);
    if (!round) return false;
    round.halt();
    return true;
  }

  /**
   * Stop every round still going or waiting, and wait until each has wound down.
   *
   * For a server that is shutting down: a round left alone goes on calling
   * models and running code for a page that will never ask again, and its
   * children outlive the process that would have reaped them.
   */
  async stopAll(): Promise<number> {
    const going = [...this.kept.values()].filter((round) => round.finishedAt === null);
    for (const round of going) round.halt();
    await Promise.all(going.map((round) => round.ended));
    return going.length;
  }

  private forgetOld(): void {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, round] of this.kept) {
      if (round.finishedAt !== null && round.finishedAt < cutoff) this.kept.delete(id);
    }
  }
}

/** *before*, or a failure as soon as *signal* aborts while it is waited for. */
function waited(before: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((ready, fail) => {
    const stop = (): void => fail(new Error('Stopped.'));
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    // Let go of the signal once it is this round's turn.
    void before.then(() => { signal.removeEventListener('abort', stop); ready(); });
  });
}
