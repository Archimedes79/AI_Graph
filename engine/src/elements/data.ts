import { NodeElement, type Runtime } from '../element.ts';
import type { GraphNode } from '../graph.ts';

export interface DataConfig {
  /** What it holds between runs. */
  value: unknown;
}

/**
 * A value that survives a run — the graph's memory.
 *
 * `isMemory` is what lets an edge back into this node close a loop: the
 * executor leaves that edge out of the ordering and settles the fresh value
 * afterwards, so the next round starts from it. A counter is a data node with
 * a code node adding one.
 */
export class DataElement extends NodeElement<DataConfig> {
  readonly nodeType = 'data' as const;
  override readonly isMemory = true;

  config(node: GraphNode): DataConfig {
    return { value: node.config.data_value ?? '' };
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, _runtime: Runtime) {
    // An update arriving this round wins; otherwise it emits what it kept.
    const incoming = inputs.input;
    const value = incoming === undefined ? this.config(node).value : incoming;
    return { output: value };
  }

  override settleMemory(node: GraphNode, _portId: string, value: unknown): void {
    node.config.data_value = value as never;
  }
}
