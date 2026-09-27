import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { DataNodeRunner } from '@engine/elements/nodes/data/DataNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { dataKind, describeDataFormat } from './dataFormat';

const DATA = new DataNodeRunner();

/** What it holds, or undefined when it holds nothing. */
function held(node: GraphNode): unknown {
  const value = node.config.data_value;
  return value === '' || value === null || value === undefined ? undefined : value;
}

export class DataNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'data';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Data Node';

  readonly hint = 'Remember a value between runs, so a loop can build on its own last result';

  readonly icon = '🗃️';

  readonly color = 'var(--ui-node-data, #183b3b)';

  // A data node IS the graph's register: it holds its value between runs,
  // which is what lets a feedback edge into it close a cycle. What it should
  // hold is asked in step 3, and published as its description.
  override readonly ownsDescription = true;

  override readonly Panel = lazy(() => import('./DataNodePanel'));

  // The same four steps as an ai or code node: what comes in and out, what it
  // holds, its format -- and after them, what it holds now.
  override readonly stepped = true;

  // The node reads "input" and hands on "output" by those names.
  override readonly portEditing = { inputs: 'fixed', outputs: 'fixed' } as const;

  override portHint(side: 'inputs' | 'outputs'): string {
    return side === 'inputs'
      ? 'Optional. What arrives here replaces what it holds, and is kept for the next run.'
      : 'What it holds: what arrived last, or what it holds now (below) until something does.';
  }

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(DATA.generation()),
    promptLabel: 'What it holds',
    promptPlaceholder: 'Describe the records, fields, types, constraints, and examples this node stores.',
    bodyLabel: 'Format',
    bodyPlaceholder: 'Field names, types, dimensions, constraints, and a representative example.',
    bodyHeight: 140,
    // What it holds now is its example (`exampleInput`) -- the most concrete
    // one there is -- and reaches its ✨ as the sample, in the brief with what
    // it is wired to. It was also pasted here a second time.
    context: (node) => `Standard format family: ${dataKind(node)}.`,
  };

  /** What it holds is step 1's example: a value of what arrives on its input. */
  override exampleInput(node: GraphNode): Record<string, unknown> | undefined {
    const value = held(node);
    return value === undefined ? undefined : { input: value };
  }

  override describeOutput(node: GraphNode): string {
    return describeDataFormat(node);
  }

  /** What it remembers, the start of it, under its ports. */
  override canvasSummary(node: GraphNode): string | undefined {
    const value = node.config.data_value;
    if (value === null || value === undefined) return undefined;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  /**
   * What it stores is what it hands on, until something new arrives: asked of
   * the engine's element, which a run asks. A structure node that holds
   * nothing hands on null, and ✨ was shown nothing where the next node is
   * handed null; an empty text is still nothing to write code against.
   */
  override restingValue(node: GraphNode): unknown {
    const handed = DATA.config(node as never).value;
    return handed === '' ? undefined : handed;
  }

  override wantsOn(node: GraphNode): string {
    return `what it stores: ${describeDataFormat(node)}`;
  }

}
