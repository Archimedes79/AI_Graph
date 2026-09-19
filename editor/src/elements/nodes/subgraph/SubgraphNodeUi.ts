import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { SubgraphNodeElement } from '@engine/elements/nodes/subgraph/SubgraphNodeElement.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';

const ELEMENT = new SubgraphNodeElement();

/**
 * A node that holds a graph.
 *
 * Its ports are the graph inside it: an input node in there is a port here, an
 * output node in there is a port here. So there is nothing to edit on this
 * node itself -- the panel is a way in, and what it lists it lists by asking
 * the engine the same question the canvas asks.
 */
export class SubgraphNodeUi extends NodeUi {
  readonly nodeType = 'subgraph';
  readonly label = 'Subgraph';
  readonly hint = 'A graph inside a node: build a part of the work on its own canvas';
  readonly icon = '🧩';
  readonly color = 'var(--ui-node-subgraph, #2a2a4a)';
  readonly settings: NodeUi['settings'] = ['subgraph', 'task', 'catch_errors'];

  override readonly ownsDescription = true;
  override readonly Panel = lazy(() => import('./SubgraphNodePanel'));

  /** Opening this node means going into it, not opening a dialog about it. */
  override readonly opensNestedGraph = true;

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

  create(id: string): GraphNode {
    return {
      id,
      node_type: 'subgraph',
      label: this.label,
      description: 'A part of the work, built as its own graph',
      position: { x: 0, y: 0 },
      // None to start with: a port here is a node in there, and there is
      // nothing in there yet.
      inputs: [],
      outputs: [],
      // The engine's own idea of an empty graph, rather than a second copy
      // of what a graph's metadata starts as.
      config: { ...baseNodeConfig(), subgraph: ELEMENT.nestedGraph({ config: {} } as never), task: '' },
    };
  }
}
