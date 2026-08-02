// Pure helpers for GUI-node widget <-> port sync. Mirrors
// backend/app/models/graph.py: gui_widget_ports / sync_gui_node_ports 1:1.
import type { GraphNode, GuiWidget, GuiWidgetKind, Port } from '../types/graph';

/** Return the (inputs, outputs) a single GUI widget contributes to its node. */
export function guiWidgetPorts(widget: GuiWidget): { inputs: Port[]; outputs: Port[] } {
  const inId = `${widget.id}_in`;
  const outId = `${widget.id}_out`;
  const label = widget.label || widget.id;

  switch (widget.kind) {
    case 'file_open':
      return {
        inputs: [],
        outputs: [{ id: outId, name: label, kind: 'output', data_type: 'file_path', multi: false, required: false, description: '' }],
      };

    case 'directory_open':
      return {
        inputs: [],
        outputs: [{ id: outId, name: label, kind: 'output', data_type: 'file_path', multi: true, required: false, description: '' }],
      };

    case 'text_window':
      return {
        inputs: [{ id: inId, name: label, kind: 'input', data_type: 'any', multi: false, required: false, description: '' }],
        outputs: [{ id: outId, name: label, kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
      };

    case 'chat_window':
      return {
        inputs: [{ id: inId, name: label, kind: 'input', data_type: 'text', multi: true, required: false, description: '' }],
        outputs: [{ id: outId, name: label, kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
      };

    case 'plot_window':
      // Display-only, like text_output: accepts data to plot, no downstream port.
      return {
        inputs: [{ id: inId, name: label, kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
        outputs: [],
      };

    default:
      throw new Error(`Unknown GUI widget kind: ${widget.kind}`);
  }
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
