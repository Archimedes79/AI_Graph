import type { GraphNodeElementDefinition } from '@/elements/types';
import GuiEditor from './Editor';
import { baseNodeConfig } from '@/elements/shared/baseNodeConfig';

export const guiElement: GraphNodeElementDefinition = {
  nodeType: 'gui',
  hasRuntimeWindow: true,
  ConfigEditor: GuiEditor,
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
