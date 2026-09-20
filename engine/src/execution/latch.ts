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
// not what the new one holds.

import { createHash } from 'node:crypto';
import type { Graph, GraphNode } from '../graph.ts';

/** How many nodes' outputs are held. A long editor session opens many graphs. */
const LIMIT = 512;

export class Latch {
  private readonly kept = new Map<string, Record<string, unknown>>();

  private key(graph: Graph, node: GraphNode): string {
    const written = [graph.metadata?.name ?? '', node.id, node.node_type, node.config, node.inputs, node.outputs];
    return createHash('sha256').update(JSON.stringify(written)).digest('hex');
  }

  get(graph: Graph, node: GraphNode): Record<string, unknown> | undefined {
    return this.kept.get(this.key(graph, node));
  }

  set(graph: Graph, node: GraphNode, outputs: Record<string, unknown>): void {
    const key = this.key(graph, node);
    this.kept.delete(key);
    this.kept.set(key, outputs);
    if (this.kept.size > LIMIT) this.kept.delete(this.kept.keys().next().value!);
  }
}
