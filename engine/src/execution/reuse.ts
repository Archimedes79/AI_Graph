// What a node produced last time, for a run that only needs it as context.
//
// A page event runs what it is *for* -- the nodes the block is wired to and
// everything after them -- and, before those, whatever they need an input
// from. That upstream part used to run again every time: change the length of
// a summary and the file was read again, which is cheap, but change a chart's
// type below a model call and the model was asked again, which is not.
//
// So a node that runs only as context may hand back what it produced last
// time, on one condition: nothing it depends on has changed. "Depends on" is
// the node as written (type, settings, ports) and every value that arrived on
// its inputs -- with wired files already read, so a file edited since is a
// different input. A node with no inputs at all reads the outside world
// instead (a file, a page, the clock) and is never reused; it is also what is
// cheap.
//
// What an event is for always runs fresh: pressing "Summarize" twice means
// "again", and a whole-graph Run means everything.

import { createHash } from 'node:crypto';
import type { GraphNode } from '../graph.ts';

/** How many results are kept. A long session must not accumulate every one it ever saw. */
const LIMIT = 256;

export class LastOutputs {
  private readonly kept = new Map<string, Record<string, unknown>>();

  /** One key for this node, as written, receiving these inputs. */
  key(node: GraphNode, inputs: Record<string, unknown>): string {
    const written = { type: node.node_type, config: node.config, inputs: node.inputs, outputs: node.outputs };
    return createHash('sha256').update(JSON.stringify([written, inputs])).digest('hex');
  }

  get(key: string): Record<string, unknown> | undefined {
    const found = this.kept.get(key);
    if (found) {
      // Most recently used goes last, so the oldest is the one dropped.
      this.kept.delete(key);
      this.kept.set(key, found);
    }
    return found;
  }

  set(key: string, outputs: Record<string, unknown>): void {
    this.kept.delete(key);
    this.kept.set(key, outputs);
    if (this.kept.size > LIMIT) this.kept.delete(this.kept.keys().next().value!);
  }
}
