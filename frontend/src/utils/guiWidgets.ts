// Pure helpers for GUI-node widget <-> port sync. Mirrors
// backend/app/models/graph.py: gui_widget_ports / sync_gui_node_ports 1:1.
import type { GraphNode, GuiWidget, GuiWidgetKind, Port } from '../types/graph';
import { GUI_WIDGET_ELEMENTS } from '../elements/registry';

/** Return the (inputs, outputs) a single GUI widget contributes to its node. */
export function guiWidgetPorts(widget: GuiWidget): { inputs: Port[]; outputs: Port[] } {
  return GUI_WIDGET_ELEMENTS[widget.kind].ports(widget);
}

/**
 * Regenerate a GUI node's inputs/outputs strictly from `config.gui_widgets`, in
 * order. No-op (returns the node unchanged) for non-GUI nodes. Call this after
 * any widget-list edit instead of hand-editing `inputs`/`outputs` directly --
 * widget ids never change, so port ids (`${id}_in` / `${id}_out`) stay stable
 * across re-syncs and existing edges remain attached.
 */
export function syncGuiNodePorts(node: GraphNode): GraphNode {
  if (node.node_type !== 'gui') return node;

  const inputs: Port[] = [];
  const outputs: Port[] = [];
  for (const widget of node.config.gui_widgets) {
    const { inputs: widgetInputs, outputs: widgetOutputs } = guiWidgetPorts(widget);
    inputs.push(...widgetInputs);
    outputs.push(...widgetOutputs);
  }

  return { ...node, inputs, outputs };
}

/** Map a named size to its default grid dimensions. */
export function sizeToGrid(size: 'small' | 'medium' | 'large'): { w: number; h: number } {
  if (size === 'small')  return { w: 3, h: 2 };
  if (size === 'large')  return { w: 12, h: 6 };
  return { w: 6, h: 4 }; // medium
}

let widgetCounter = 1;
export function newGuiWidgetId(): string {
  return `widget-${widgetCounter++}-${Date.now()}`;
}

export function createGuiWidget(kind: GuiWidgetKind, label = ''): GuiWidget {
  const size = 'medium';
  return {
    id: newGuiWidgetId(),
    kind,
    label,
    value: '',
    extensions: '',
    mode: kind === 'input_picker' ? 'file' : kind === 'text_io' ? 'both' : '',
    size,
    ...sizeToGrid(size),
    code: '',
    language: 'python',
  };
}

export const GUI_WIDGET_KIND_LABELS: Record<GuiWidgetKind, string> = {
  file_open: 'File Open (legacy)',
  directory_open: 'Directory Open (legacy)',
  input_picker: 'Input Picker (file or directory)',
  text_window: 'Text Window (legacy)',
  chat_window: 'Chat Window (legacy)',
  text_io: 'Text I/O (input / output / both)',
  plot_window: 'Plot Window',
};

/** Kinds offered when creating a brand-new widget -- legacy kinds are load-only. */
export const CREATABLE_GUI_WIDGET_KINDS: GuiWidgetKind[] = ['input_picker', 'text_io', 'plot_window'];
