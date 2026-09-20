import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { TriggerNodeElement } from '@engine/elements/nodes/trigger/TriggerNodeElement.ts';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';

const ELEMENT = new TriggerNodeElement();

/**
 * What starts a graph with nobody there: the tool starting, and a clock.
 *
 * An event on the canvas like a button's, so what it starts is what it is wired
 * to -- and wired to nothing, everything.
 */
export class TriggerNodeUi extends NodeUi {
  readonly nodeType = 'trigger';
  readonly label = 'Trigger';
  readonly hint = 'Start the graph by itself: when the tool starts, or again every few minutes';
  readonly icon = '⏱️';
  readonly color = 'var(--ui-node-trigger, #4a3a12)';
  readonly settings: NodeUi['settings'] = ['trigger_on_start', 'trigger_every'];

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

  create(id: string): GraphNode {
    return {
      id,
      node_type: 'trigger',
      label: 'Start',
      description: 'What starts this graph by itself',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: ELEMENT.derivedPorts().outputs as GraphNode['outputs'],
      config: { ...baseNodeConfig(), trigger_on_start: true, trigger_every: '' },
    };
  }
}
