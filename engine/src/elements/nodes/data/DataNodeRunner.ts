import { NodeRunner, type TextFile, type WhatRuns } from '../../NodeRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import type { GraphNode } from '../../../graph.ts';
import type { Generation } from '../../../authoring/generation.ts';
import type { Problem } from '../../../execution/wiring.ts';

export interface DataConfig {
  /** What it holds between runs. */
  value: unknown;
}

/**
 * A value that survives a run — the graph's memory.
 *
 * A value: its kind (text or structure) and what it holds, which is what it
 * hands on and what the nodes wired to it are shown. It keeps it in a file of
 * its own -- data.json or data.txt, by its kind -- and ✨ Data writes it from
 * the node's text, shaped as the nodes it feeds want it.
 *
 * `isMemory` is what lets an edge back into this node close a loop: the
 * executor leaves that edge out of the ordering and settles the fresh value
 * afterwards, so the next round starts from it. A counter is a data node with
 * a code node adding one.
 */
export class DataNodeRunner extends NodeRunner<DataConfig> {
  readonly nodeType = 'data' as const;

  /**
   * What it holds -- as JSON where it holds structure, and there from the
   * start, holding nothing: `null`, or no text -- and every exchange with the
   * model about it.
   */
  override texts(node: GraphNode): readonly TextFile[] {
    const structure = node.config.data_format === 'structure';
    return [
      structure ? { field: 'data_value', file: 'data.json', json: true, standard: 'null' } : { field: 'data_value', file: 'data.txt', standard: '' },
      { field: 'history', file: 'history.md' },
    ];
  }

  /**
   * Holding nothing is said in the node's own kind: empty text for a text
   * node, and null for a structure. A cleared structure used to hand on "",
   * which `inputs.input ?? []` lets through as a string, and which was not the
   * nothing the neighbour's ✨ had been shown.
   */
  config(node: GraphNode): DataConfig {
    return { value: node.config.data_value ?? (node.config.data_format === 'structure' ? null : '') };
  }

  override readonly isMemory = true;

  /** It keeps what it is handed, whether or not the edge closes a loop. */
  override readonly settlesOnArrival = true;

  async execute(node: GraphNode, inputs: Record<string, unknown>, _runtime: Runtime) {
    // An update arriving this round wins; otherwise it emits what it kept.
    const incoming = inputs.input;
    const value = incoming === undefined ? this.config(node).value : incoming;
    return { output: value };
  }

  /**
   * What arrived is what it holds from now on -- and a text node handed
   * something that is not text, a count or a list, holds structure from then
   * on: kept in data.json, it reads back as what it is. In data.txt a
   * counter's 1 came back "1", and the next round made it "11".
   */
  override settleMemory(node: GraphNode, _portId: string, value: unknown): void {
    node.config.data_value = value as never;
    if (value !== null && value !== undefined && typeof value !== 'string') node.config.data_format = 'structure';
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return 'persisted graph memory, with one optional input port named "input" and one output port named "output". '
      + 'config.data_value is what it holds and hands on; what arrives on "input" replaces it and is kept for the next run. '
      + 'Set config.data_format to text or structure (JSON), and initialize config.data_value when useful. '
      + 'Its description says in words what it holds: the nodes wired to it are generated against that and its value.';
  }

  /** What it holds, written from its text and from what the nodes it feeds want. */
  override generation(): Generation {
    return { kind: 'data', fields: { body: 'data_value' } };
  }

  override whatRuns(): WhatRuns {
    return this.engineRuns('Hands on what arrives this round, or else what it kept; what arrives is kept for the next round.');
  }

  /**
   * A text node that holds what is not text -- a count, a list, a record, set
   * so by hand or by a model -- is kept in data.txt as its JSON and read back
   * from there as that text: the nodes it feeds would be handed a string. A run
   * makes such a node a structure (`settleMemory`); anything else is named.
   */
  override problems(node: GraphNode, _elements: unknown, where: string): Problem[] {
    const value = node.config.data_value;
    if (node.config.data_format === 'structure' || value === null || value === undefined || typeof value === 'string') return [];
    return [{
      where,
      problem: 'It is kept as text but holds structured data: saved, it comes back from data.txt as text.',
      fix: 'Set its Kind to Structure (JSON) in its panel (data_format "structure" in a graph file): it is kept in data.json then.',
    }];
  }
}
