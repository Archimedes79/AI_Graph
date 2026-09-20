// What every node last produced, held until it runs again.
//
// A node's ◆ is a gate, and a round that does not open it leaves the node
// standing. But another node may run in that round and need what the first one
// made: the length of a summary is changed, the summarizer runs, and the reader
// whose ◆ hangs on the "Read" button does not. So an output is a level, not a
// moment -- it stays on the wire until its node runs again -- and this is where
// it stays.
//
// **Not the reuse cache.** `reuse.ts` is an optimisation: same node, same
// inputs, same answer, so the work is skipped -- and throwing it away changes
// nothing but the time a run takes. This is meaning: the last value *stands*,
// whatever the inputs are today, and a graph behaves differently without it.
//
// **Not a data node either.** That is memory somebody placed: it is in the
// graph, it is saved, it may close a loop. This is every output, by itself,
// for as long as the process holding the graph lives. After a restart nothing
// is held, a gated node has nothing to hand on, and what needs it waits for
// the event that opens the gate.
//
// Kept per node *as written*: edit a node's code and what the old code made is
// not what the new one holds. A node that keeps something of its own -- a data
// node, a page -- is the exception: its config changes with every round that
// settles into it, so "as written" would forget it each time. It is known by
// where it is.

import { createHash } from 'node:crypto';
import type { Graph, GraphNode } from '../graph.ts';

/** How many nodes' outputs are held. A long editor session opens many graphs. */
const LIMIT = 512;

export class Latch {
  private readonly kept = new Map<string, Record<string, unknown>>();

  private key(graph: Graph, node: GraphNode, keepsItsOwn: boolean): string {
    const written = [graph.metadata?.name ?? '', node.id, node.node_type, keepsItsOwn ? null : node.config, node.inputs, node.outputs];
    return createHash('sha256').update(JSON.stringify(written)).digest('hex');
  }

  get(graph: Graph, node: GraphNode, keepsItsOwn = false): Record<string, unknown> | undefined {
    const key = this.key(graph, node, keepsItsOwn);
    const found = this.kept.get(key);
    // Read is used: a node that only ever stands still must not be the first to go.
    if (found) { this.kept.delete(key); this.kept.set(key, found); }
    return found;
  }

  set(graph: Graph, node: GraphNode, outputs: Record<string, unknown>, keepsItsOwn = false): void {
    const key = this.key(graph, node, keepsItsOwn);
    this.kept.delete(key);
    this.kept.set(key, outputs);
    if (this.kept.size > LIMIT) this.kept.delete(this.kept.keys().next().value!);
  }
}
