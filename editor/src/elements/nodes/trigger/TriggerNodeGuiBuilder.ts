import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { TriggerNodeRunner } from '@engine/elements/nodes/trigger/TriggerNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

const ELEMENT = new TriggerNodeRunner();

/**
 * What starts a graph with nobody there: the tool starting, and a clock.
 *
 * An event on the canvas like a button's, so what it starts is what it is wired
 * to -- and wired to nothing, everything.
 */
export class TriggerNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'trigger';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Trigger';

  readonly hint = 'Start the graph by itself: when the tool starts, or again every few minutes';

  readonly icon = '⏱️';

  readonly color = 'var(--ui-node-trigger, #4a3a12)';

  override readonly Panel = lazy(() => import('./TriggerNodePanel'));

  override describeOutput(): string {
    return 'a boolean: true in the round this trigger started, false in any other';
  }

  /** When it fires, under its port: the one thing worth reading without opening it. */
  override canvasSummary(node: GraphNode): string | undefined {
    const { onStart, every } = ELEMENT.config(node as never);
    const parts = [onStart ? 'at start' : '', every ? `every ${every}` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'never';
  }

}
