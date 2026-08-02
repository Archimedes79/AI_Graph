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

let widgetCounter = 1;
export function newGuiWidgetId(): string {
  return `widget-${widgetCounter++}-${Date.now()}`;
}

export function createGuiWidget(kind: GuiWidgetKind, label = ''): GuiWidget {
  return {
    id: newGuiWidgetId(),
    kind,
    label,
    value: '',
    extensions: '',
    size: 'medium',
    code: '',
    language: 'python',
  };
}

export const GUI_WIDGET_KIND_LABELS: Record<GuiWidgetKind, string> = {
  file_open: 'File Open',
  directory_open: 'Directory Open',
  text_window: 'Text Window',
  chat_window: 'Chat Window',
  plot_window: 'Plot Window',
};
