import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { DataNodeRunner } from '@engine/elements/nodes/data/DataNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { describeDataFormat } from './dataFormat';

export class DataNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'data';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Data Node';

  readonly hint = 'Remember a value between runs, so a loop can build on its own last result';

  readonly icon = '🗃️';

  readonly color = 'var(--ui-node-data, #183b3b)';

  // A data node IS the graph's register: it holds its value between runs,
  // which is what lets a feedback edge into it close a cycle.
  override readonly ownsDescription = true;

  override readonly Panel = lazy(() => import('./DataNodePanel'));

  // The node reads "input" and hands on "output" by those names: what each
  // carries can be said, but not what it is called.
  override readonly portEditing = { inputs: 'describe', outputs: 'describe' } as const;

  override portHint(side: 'inputs' | 'outputs'): string {
    return side === 'inputs'
      ? 'Optional. What arrives here replaces the stored value, and is kept for the next run.'
      : 'The stored value -- what arrived last, or the stored content above until something does.';
  }

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new DataNodeRunner().generation()),
    promptLabel: 'Format generation prompt',
    promptPlaceholder: 'Describe the records, fields, types, constraints, and examples this node stores.',
    bodyLabel: 'Defined data format',
    bodyPlaceholder: 'Field names, types, dimensions, constraints, and a representative example.',
    mono: true,
    bodyHeight: 140,
    context: (node) => `Standard format family: ${node.config.data_format}.`,
  };

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

  override describeAsTarget(node: GraphNode): string {
    return `Target data format required by "${node.label}": ${describeDataFormat(node)}`;
  }

}
