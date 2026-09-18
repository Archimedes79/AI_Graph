import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';

/** A composite: it holds widgets, generates nothing itself, and emits what its widgets emit. */
export class GuiNodeUi extends NodeUi {
  readonly nodeType = 'gui';
  readonly label = 'GUI Node';
  readonly hint = 'Give the graph its own interface, built from widgets';
  readonly icon = '🖥️';
  readonly color = 'var(--ui-node-gui, #4a1d3a)';

  override readonly hasRuntimeWindow = true;
  override readonly outputContract = 'widgets';
  override readonly Panel = lazy(() => import('./GuiNodePanel'));

  override describeOutput(): string {
    return 'values from its widgets';
  }

  create(id: string): GraphNode {
    return {
      id,
      node_type: 'gui',
      label: this.label,
      description: 'A composed panel of interactive widgets (file/directory pickers, text/chat windows)',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      config: { ...baseNodeConfig(), gui_widgets: [] },
    };
  }
}
