import type { GraphNode, NodeType } from '../types/graph';
import { baseNodeConfig } from '../elements/shared/baseNodeConfig';
import { NODE_ELEMENTS } from '../elements/registry';
import { createGuiWidget, guiWidgetPorts } from './guiWidgets';

export function nodeTypeDefaults(nodeType: NodeType, id: string): GraphNode {
  return NODE_ELEMENTS[nodeType].create(id);
}

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  input: 'Input',
  ai: 'AI Node',
  code: 'Code Node',
  data: 'Data Node',
  output: 'Output',
  gui: 'GUI Node',
  widget: 'Widget',
};

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  input: '#1e3a5f',
  ai: '#2d1b4e',
  code: '#1a3a2a',
  data: '#183b3b',
  output: '#3a2000',
  gui: '#4a1d3a',
  widget: '#3a1d4a',
};

export const NODE_TYPE_ICON: Record<NodeType, string> = {
  input: '📥',
  ai: '🤖',
  code: '⚙️',
  data: '🗃️',
  output: '📤',
  gui: '🖥️',
  widget: '🧩',
};

export interface NodePreset {
  id: string;
  nodeType: NodeType;
  label: string;
  icon: string;
  description: string;
  build: (id: string) => GraphNode;
}

// File-reading presets were removed: Input's "file" mode (and input_picker's
// file mode + a downstream node's `read_file_inputs`) already reads a file's
// content directly with no AI/code involved -- see AGENTS.md's element table.
export const NODE_PRESETS: NodePreset[] = [];

/**
 * One-click standalone `widget` node per creatable GuiWidgetKind -- the same
 * widget kinds offered inside a `gui` node's widget list (see
 * `CREATABLE_GUI_WIDGET_KINDS`), each pre-populated so it's immediately
 * connectable without opening the config editor first.
 */
export const WIDGET_PRESETS: NodePreset[] = [
  {
    id: 'widget_input_picker',
    nodeType: 'widget',
    label: 'File/Directory Picker',
    icon: '📂',
    description: 'A standalone file or directory picker widget',
    build: (id) => {
      const widget = createGuiWidget('input_picker', 'Picker');
      const { inputs, outputs } = guiWidgetPorts(widget);
      return {
        id,
        node_type: 'widget',
        label: 'File/Directory Picker',
        description: 'A standalone file or directory picker widget',
        position: { x: 0, y: 0 },
        inputs,
        outputs,
        config: { ...baseNodeConfig(), gui_widgets: [widget] },
      };
    },
  },
  {
    id: 'widget_text_io',
    nodeType: 'widget',
    label: 'Text I/O',
    icon: '💬',
    description: 'A standalone text input / output / chat widget',
    build: (id) => {
      const widget = createGuiWidget('text_io', 'Text');
      const { inputs, outputs } = guiWidgetPorts(widget);
      return {
        id,
        node_type: 'widget',
        label: 'Text I/O',
        description: 'A standalone text input / output / chat widget',
        position: { x: 0, y: 0 },
        inputs,
        outputs,
        config: { ...baseNodeConfig(), gui_widgets: [widget] },
      };
    },
  },
  {
    id: 'widget_plot_window',
    nodeType: 'widget',
    label: 'Plot',
    icon: '📊',
    description: 'A standalone plot display widget',
    build: (id) => {
      const widget = createGuiWidget('plot_window', 'Plot');
      const { inputs, outputs } = guiWidgetPorts(widget);
      return {
        id,
        node_type: 'widget',
        label: 'Plot',
        description: 'A standalone plot display widget',
        position: { x: 0, y: 0 },
        inputs,
        outputs,
        config: { ...baseNodeConfig(), gui_widgets: [widget] },
      };
    },
  },
];

/** Every preset across both sections of the Sidebar palette -- used to resolve a drag/drop by preset id. */
export const ALL_NODE_PRESETS: NodePreset[] = [...NODE_PRESETS, ...WIDGET_PRESETS];
