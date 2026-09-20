// One round of a graph at a time.
//
// Two events on one page used to mean two runs at once: both read the graph as
// it was, both settled what they remembered, and whichever finished last was
// what the page kept. With outputs that stand between rounds (`latch.ts`) that
// stops being merely untidy -- a round would read what another is halfway
// through replacing. So rounds of one graph queue, in the order they were
// asked for; different graphs do not wait for each other.
//
// A round that is waiting can still be stopped: its signal is already aborted
// when its turn comes, and it ends before it starts anything.

import type { Graph } from '../graph.ts';

export class Rounds {
  private readonly last = new Map<string, Promise<void>>();

  /** Run *work* once every round of this graph asked for earlier has ended. */
  turn<T>(graph: Graph, work: () => Promise<T>): Promise<T> {
    const key = graph.metadata?.name ?? '';
    const before = this.last.get(key) ?? Promise.resolve();
    const mine = before.then(work);
    // The next in line waits for this one to end, however it ends.
    const settled = mine.then(() => {}, () => {});
    this.last.set(key, settled);
    void settled.then(() => { if (this.last.get(key) === settled) this.last.delete(key); });
    return mine;
  }
}
