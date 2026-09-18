import { lazy } from 'react';
import type { NodeUi } from '../../ElementUi';
import { baseNodeConfig } from '../baseNodeConfig';

export const guiNodeUi: NodeUi = {
  nodeType: 'gui',
  hasRuntimeWindow: true,
  Panel: lazy(() => import('./GuiNodePanel')),
  // A composite: it generates nothing itself, and what it emits is decided by
  // its widgets, which is why the summary is derived rather than editable.
  describeOutput: () => 'values from its widgets',
  outputContract: 'widgets',
  create: (id) => ({
    id,
    node_type: 'gui',
    label: 'GUI Node',
    description: 'A composed panel of interactive widgets (file/directory pickers, text/chat windows)',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    config: { ...baseNodeConfig(), gui_widgets: [] },
  }),
};
