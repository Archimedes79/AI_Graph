import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { DataNodeRunner } from '@engine/elements/nodes/data/DataNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { describeDataFormat } from './dataFormat';

const DATA = new DataNodeRunner();

export class DataNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'data';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Data';

  readonly hint = 'Remember a value between runs, so a loop can build on its own last result';

  readonly icon = '🗃️';

  readonly color = 'var(--ui-node-data, #183b3b)';

  // A data node IS the graph's register: it holds its value between runs,
  // which is what lets a feedback edge into it close a cycle. Its panel is its
  // text, that value -- its kind and what it holds -- and ✨ Data, which writes
  // the value from the text.
  override readonly ownsDescription = true;

  override readonly Panel = lazy(() => import('./DataNodePanel'));

  // The node reads "input" and hands on "output" by those names.
  override readonly portEditing = { inputs: 'fixed', outputs: 'fixed' } as const;

  override portHint(side: 'inputs' | 'outputs'): string {
    return side === 'inputs'
      ? 'Optional. What arrives here replaces what it holds, and is kept for the next run.'
      : 'What it holds: what arrived last, or the value above until something does.';
  }

  /** A file dropped on it on the canvas is what it holds from now on: what the file says. */
  override dropPort(): 'text' {
    return 'text';
  }

  override withDropped(node: GraphNode, value: unknown): GraphNode {
    return { ...node, config: { ...node.config, data_value: value } };
  }

  /** Its kind, and what its text says it holds: what the nodes wired to it are told it hands on. */
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
   * the engine's element, which a run asks. An empty text is nothing to hand on.
   */
  override restingValue(node: GraphNode): unknown {
    const handed = DATA.config(node as never).value;
    return handed === '' ? undefined : handed;
  }

  override wantsOn(node: GraphNode): string {
    return `what it stores: ${describeDataFormat(node)}`;
  }

}
