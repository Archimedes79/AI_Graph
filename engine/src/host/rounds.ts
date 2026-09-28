// One round of a graph at a time.
//
// Two events on one page used to mean two runs at once: both read the graph as
// it was, both settled what they remembered, and whichever finished last was
// what the page kept. With outputs that stand between rounds (`latch.ts`) that
// stops being merely untidy -- a round would read what another is halfway
// through replacing. So rounds of one graph queue, in the order they were
// asked for; different graphs do not wait for each other. Which graph a round
// is of is its name and shape (`graphKey`): every new graph is called
// "Untitled Graph", so a name alone made strangers queue.
//
// A round that is waiting can still be stopped: its signal is already aborted
// when its turn comes, and it ends before it starts anything. One that hands
// its signal in here goes at once instead: the clock's, whose stop a shutdown
// waits for before it stops the page's run that round is queued behind.

import type { Graph } from '../graph.ts';
import { graphKey } from '../execution/latch.ts';

export class Rounds {
  private readonly last = new Map<string, Promise<void>>();

  /**
   * Run *work* once every round of this graph asked for earlier has ended --
   * or not at all when *signal* aborts before then: the turn fails at once.
   */
  turn<T>(graph: Graph, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const key = graphKey(graph);
    const before = this.last.get(key) ?? Promise.resolve();
    const mine = waited(before, signal).then(work);
    // The next in line waits for this one to end, however it ends -- and for
    // the ones ahead of it, which a round stopped while it waited did not end.
    const settled = before.then(() => mine).then(() => {}, () => {});
    this.last.set(key, settled);
    void settled.then(() => { if (this.last.get(key) === settled) this.last.delete(key); });
    return mine;
  }
}

/** *before*, or a failure as soon as *signal* aborts while it is waited for. */
function waited(before: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return before;
  return new Promise((ready, fail) => {
    const stop = (): void => fail(new Error('Stopped.'));
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    // Let go of the signal once it is this round's turn: a clock's lives as
    // long as the server, and would otherwise gather a listener every round.
    void before.then(() => { signal.removeEventListener('abort', stop); ready(); });
  });
}
