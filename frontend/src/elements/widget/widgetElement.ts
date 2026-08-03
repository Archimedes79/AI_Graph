import type { NodeElementDefinition } from '../types';
import GuiEditor from '../gui/GuiEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

/**
 * The `widget` node -- a standalone single GuiWidget on the canvas. It reuses
 * the exact same `GuiElement`/`GuiEditor` a `gui` node uses for its whole
 * widget list (see AGENTS.md); the only difference is that this node's
 * `config.gui_widgets` typically holds just one widget. Every widget kind is
 * therefore automatically available both inside a composed `gui` window and
 * as its own graph node -- see `WIDGET_PRESETS` in `utils/nodeDefaults.ts`
 * for the one-click-per-kind palette entries.
 */
export const widgetElement: NodeElementDefinition = {
  nodeType: 'widget',
  ConfigEditor: GuiEditor,
  create: (id) => ({
    id,
    node_type: 'widget',
    label: 'Widget',
    description: 'A single interactive widget, standalone on the canvas',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    config: { ...baseNodeConfig(), gui_widgets: [] },
  }),
};
