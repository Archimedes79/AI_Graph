import type { GraphNodeElementDefinition } from '@/elements/types';
import GuiEditor from './Editor';
import { baseNodeConfig } from '@/elements/shared/baseNodeConfig';

export const guiElement: GraphNodeElementDefinition = {
  nodeType: 'gui',
  // Its widgets keep their values between runs, so an edge into one closes a
  // cycle the same way a data node does.
  isMemory: true,
  // One value per widget, addressed by the port the edge landed on: a gui
  // node's ports are named '<widgetId>_in' / '_out' by construction.
  settleMemoryValue: (node, portId, value) => {
    const widgetId = portId.endsWith('_in') ? portId.slice(0, -'_in'.length) : portId;
    const widget = node.config.gui_widgets?.find((w) => w.id === widgetId);
    if (widget) widget.value = value as never;
  },
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
