import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { DataNodeRunner } from '@engine/elements/nodes/data/DataNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { dataKind, describeDataFormat } from './dataFormat';

/** How much of what it holds ✨ is shown: enough for its shape and a few records. */
const HELD_BUDGET = 1200;

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
    // What it holds now is its example -- the most concrete one there is, and
    // it was never sent to its own ✨ at all.
    context: (node) => {
      const value = held(node);
      const text = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const shown = text.length > HELD_BUDGET ? `${text.slice(0, HELD_BUDGET)}\n… (${text.length - HELD_BUDGET} more characters)` : text;
      return [`Standard format family: ${dataKind(node)}.`, shown && `What it holds now:\n${shown}`].filter(Boolean).join('\n\n');
    },
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

  // The wording for a data node is kept verbatim: its format is the one
  // contract a user writes deliberately, and existing prompts were tuned to it.
  override describeAsSource(node: GraphNode, emits: string): string {
    return `Source data format from "${node.label}": ${emits}`;
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

  override describeAsTarget(node: GraphNode): string {
    return `Target data format required by "${node.label}": ${describeDataFormat(node)}`;
  }

}
