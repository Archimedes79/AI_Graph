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
// **Whose value it is.** A graph carries no identity of its own -- a new one
// is "Untitled Graph", like every other -- so a held value is kept under what
// made it: the graph's name and shape (its nodes and wires), the node as
// written, and every node upstream of it as written. Two graphs that differ
// anywhere a value could come from never hand each other one; edit a node's
// code, or the code of what feeds it, and what the old code made is not what
// the new one holds. A node that keeps something of its own -- a data node, a
// page -- counts without its settings: they change with every round that
// settles into it, so "as written" would forget it each time.

import { createHash } from 'node:crypto';
import type { Graph, GraphNode } from '../graph.ts';
import { upstreamOf } from './triggers.ts';

/** How many nodes' outputs are held. A long editor session opens many graphs. */
const LIMIT = 512;

/** A graph's name and shape -- which nodes of which types, wired how -- as one key. What rounds of one graph queue by, too. */
export function graphKey(graph: Graph): string {
  const shape = [
    graph.metadata?.name ?? '',
    graph.nodes.map((node) => `${node.id}:${node.node_type}`).sort(),
    graph.edges.map((edge) => `${edge.source_node_id}.${edge.source_port_id}>${edge.target_node_id}.${edge.target_port_id}`).sort(),
  ];
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

export class Latch {
  private readonly kept = new Map<string, Record<string, unknown>>();

  /** Whose value this is: see the header. *keepsItsOwn* says which nodes count without their settings. */
  key(graph: Graph, node: GraphNode, keepsItsOwn: (node: GraphNode) => boolean): string {
    const byId = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
    const made = [...upstreamOf(graph, [node.id], new Set())].sort().map((id) => {
      const from = byId.get(id);
      return from ? [from.id, from.node_type, keepsItsOwn(from) ? null : from.config, from.inputs, from.outputs] : [id];
    });
    return createHash('sha256').update(JSON.stringify([graphKey(graph), node.id, made])).digest('hex');
  }

  get(key: string): Record<string, unknown> | undefined {
    const found = this.kept.get(key);
    // Read is used: a node that only ever stands still must not be the first to go.
    if (found) { this.kept.delete(key); this.kept.set(key, found); }
    return found;
  }

  set(key: string, outputs: Record<string, unknown>): void {
    this.kept.delete(key);
    this.kept.set(key, outputs);
    if (this.kept.size > LIMIT) this.kept.delete(this.kept.keys().next().value!);
  }
}
