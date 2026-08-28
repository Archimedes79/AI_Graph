import type { GraphNode, NodeType } from '../types/graph';
import { baseNodeConfig } from '../elements/shared/baseNodeConfig';
import { NODE_ELEMENTS } from '../elements/registry';
import { createGuiWidget, guiWidgetPorts } from './guiWidgets';

export function nodeTypeDefaults(nodeType: NodeType, id: string): GraphNode {
  return NODE_ELEMENTS[nodeType].create(id);
}

// Shown on hover in the palette. The widget presets below carried a description
// from the start; the node types -- the ones a newcomer meets first -- did not,
// so "Data Node" had to be guessed from two words and an icon.
export const NODE_TYPE_DESCRIPTIONS: Record<NodeType, string> = {
  input: 'A value from outside the graph: typed text, one file, or a directory listing',
  ai: 'Send a prompt to a local or hosted model and pass on its answer',
  code: 'Run Python or JavaScript — write it yourself or have the AI generate it',
  data: 'Remember a value between runs, so a loop can build on its own last result',
  output: 'Show the result in a window, or write it to a file or directory',
  gui: 'Give the graph its own interface, built from widgets',
};

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  input: 'Input',
  ai: 'AI Node',
  code: 'Code Node',
  data: 'Data Node',
  output: 'Output',
  gui: 'GUI Node',
};

export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  input: '#1e3a5f',
  ai: '#2d1b4e',
  code: '#1a3a2a',
  data: '#183b3b',
  output: '#3a2000',
  gui: '#4a1d3a',
};

export const NODE_TYPE_ICON: Record<NodeType, string> = {
  input: '📥',
  ai: '🤖',
  code: '⚙️',
  data: '🗃️',
  output: '📤',
  gui: '🖥️',
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
 * One-click palette entry per creatable GuiWidgetKind: a `gui` node holding
 * just that one widget. There is no separate node type for it -- the same
 * widget kinds are offered inside a `gui` node's widget list (see
 * `CREATABLE_GUI_WIDGET_KINDS`), each pre-populated so it's immediately
 * connectable without opening the config editor first.
 */
export const WIDGET_PRESETS: NodePreset[] = [
  {
    id: 'widget_input_picker',
    nodeType: 'gui',
    label: 'File/Directory Picker',
    icon: '📂',
    description: 'A standalone file or directory picker widget',
    build: (id) => {
      const widget = createGuiWidget('input_picker', 'Picker');
      const { inputs, outputs } = guiWidgetPorts(widget);
      return {
        id,
        node_type: 'gui',
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
    nodeType: 'gui',
    label: 'Text I/O',
    icon: '💬',
    description: 'A standalone text input / output / chat widget',
    build: (id) => {
      const widget = createGuiWidget('text_io', 'Text');
      const { inputs, outputs } = guiWidgetPorts(widget);
      return {
        id,
        node_type: 'gui',
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
    nodeType: 'gui',
    label: 'Plot',
    icon: '📊',
    description: 'A standalone plot display widget',
    build: (id) => {
      const widget = createGuiWidget('plot_window', 'Plot');
      const { inputs, outputs } = guiWidgetPorts(widget);
      return {
        id,
        node_type: 'gui',
        label: 'Plot',
        description: 'A standalone plot display widget',
        position: { x: 0, y: 0 },
        inputs,
        outputs,
        config: { ...baseNodeConfig(), gui_widgets: [widget] },
      };
    },
  },
  {
    id: 'widget_image_view',
    nodeType: 'gui',
    label: 'Image',
    icon: '🖼️',
    description: 'A standalone image display widget',
    build: (id) => {
      const widget = createGuiWidget('image_view', 'Image');
      const { inputs, outputs } = guiWidgetPorts(widget);
      return {
        id,
        node_type: 'gui',
        label: 'Image',
        description: 'A standalone image display widget',
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
