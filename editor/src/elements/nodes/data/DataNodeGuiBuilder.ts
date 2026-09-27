import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { DataNodeRunner } from '@engine/elements/nodes/data/DataNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { describeDataFormat } from './dataFormat';

const DATA = new DataNodeRunner();

export class DataNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'data';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Data Node';

  readonly hint = 'Remember a value between runs, so a loop can build on its own last result';

  readonly icon = '🗃️';

  readonly color = 'var(--ui-node-data, #183b3b)';

  // A data node IS the graph's register: it holds its value between runs,
  // which is what lets a feedback edge into it close a cycle. Its dialog is
  // that value -- its kind and what it holds -- and nothing to write or generate.
  override readonly Panel = lazy(() => import('./DataNodePanel'));

  // The node reads "input" and hands on "output" by those names.
  override readonly portEditing = { inputs: 'fixed', outputs: 'fixed' } as const;

  override portHint(side: 'inputs' | 'outputs'): string {
    return side === 'inputs'
      ? 'Optional. What arrives here replaces what it holds, and is kept for the next run.'
      : 'What it holds: what arrived last, or the value above until something does.';
  }

  /** Its kind, and what its description says it holds: what the nodes wired to it are told it hands on. */
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
