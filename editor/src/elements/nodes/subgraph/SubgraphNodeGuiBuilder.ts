import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { SubgraphNodeRunner } from '@engine/elements/nodes/subgraph/SubgraphNodeRunner.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

const ELEMENT = new SubgraphNodeRunner();

/**
 * A node that holds a graph.
 *
 * Its ports are the graph inside it: an input node in there is a port here, an
 * output node in there is a port here. So there is nothing to edit on this
 * node itself -- the panel is a way in, and what it lists it lists by asking
 * the engine the same question the canvas asks.
 */
export class SubgraphNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'subgraph';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Subgraph';

  readonly hint = 'A graph inside a node: build a part of the work on its own canvas';

  readonly icon = '🧩';

  readonly color = 'var(--ui-node-subgraph, #2a2a4a)';

  override readonly ownsDescription = true;

  override readonly Panel = lazy(() => import('./SubgraphNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./SubgraphNodeAdvancedPanel'));

  override readonly advancedSummary = 'run.js';

  override describeOutput(node: GraphNode): string {
    const ports = ELEMENT.derivedPorts(node as never, engineRegistry)?.outputs ?? [];
    return ports.length
      ? `Whatever the graph inside puts on: ${ports.map((port) => port.name).join(', ')}.`
      : 'Nothing yet: the graph inside has no output node.';
  }

  /** What it is for, before anyone has looked inside. */
  override canvasSummary(node: GraphNode): string | undefined {
    const task = String(node.config.task ?? '').trim();
    return task ? task.split('\n')[0] : undefined;
  }

}
