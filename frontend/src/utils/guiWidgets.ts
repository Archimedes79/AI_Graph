// Pure helpers for GUI-node widget <-> port sync. Mirrors
// backend/app/models/graph.py: gui_widget_ports / sync_gui_node_ports 1:1.
import type { GraphNode, GuiWidget, GuiWidgetKind, Port } from '../types/graph';
import { GUI_WIDGET_ELEMENTS } from '../elements/registry';
import { DEFAULT_WIDGET_SPAN } from '../components/gui/layout';
import type { Tone } from '../components/gui/tone';

/** Return the (inputs, outputs) a single GUI widget contributes to its node. */
export function guiWidgetPorts(widget: GuiWidget): { inputs: Port[]; outputs: Port[] } {
  return GUI_WIDGET_ELEMENTS[widget.kind].ports(widget);
}

/**
 * Regenerate a GUI/WIDGET node's inputs/outputs strictly from
 * `config.gui_widgets`, in order. No-op (returns the node unchanged) for any
 * other node type. Call this after any widget-list edit instead of
 * hand-editing `inputs`/`outputs` directly -- widget ids never change, so
 * port ids (`${id}_in` / `${id}_out`) stay stable across re-syncs and
 * existing edges remain attached. A WIDGET node is just a GUI node whose
 * `gui_widgets` holds exactly one widget -- same derivation.
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

export function createGuiWidget(kind: GuiWidgetKind, label = '', mode?: string): GuiWidget {
  return {
    id: newGuiWidgetId(),
    kind,
    label,
    value: '',
    extensions: '',
    mode: mode ?? (kind === 'input_picker' ? 'file' : kind === 'text_io' ? 'both'
      : kind === 'text' ? 'body'
      : kind === 'divider' || kind === 'spacer' ? 'horizontal' : ''),
    // No x/y: the order of the list is the position, so a new block simply goes
    // last -- "add" never has to ask where to put it.
    ...defaultSpanFor(kind, mode),
    tone: defaultToneFor(kind, mode),
    code: '',
    language: 'python',
    recursive: false,
    select_all_files: true,
    selector_prompt: '',
    selector_code: '',
    code_prompt: '',
    code_file: '',
    example_file: '',
  };
}

export const GUI_WIDGET_KIND_LABELS: Record<GuiWidgetKind, string> = {
  text: 'Text / Überschrift',
  divider: 'Trennlinie',
  spacer: 'Abstand',
  input_picker: 'Datei-/Ordnerauswahl',
  text_io: 'Textfeld (Eingabe / Ausgabe / beides)',
  table: 'Tabelle',
  plot_window: 'Diagramm',
  image_view: 'Bild',
};

/**
 * Kinds offered when adding a block, in the order a page is usually built:
 * furniture first, then fields, then displays.
 */
export const CREATABLE_GUI_WIDGET_KINDS: GuiWidgetKind[] = [
  'text', 'divider', 'spacer',
  'input_picker', 'text_io',
  'table', 'plot_window', 'image_view',
];

/** Page furniture: no ports, no behaviour. Mirrors `StaticWidget` on the backend. */
export const STATIC_KINDS: GuiWidgetKind[] = ['text', 'divider', 'spacer'];

/**
 * A sensible first appearance per kind -- the counterpart of defaultSpanFor.
 *
 * Only what you *operate* gets a frame. A box around a heading, a plot or a
 * table is a box around something that already has a shape of its own, and a
 * page of them reads as an inspector rather than a document; a field you type
 * into, on the other hand, has to look like a field or nobody clicks it.
 *
 * A default, not a rule: every block's `tone` is still yours to change in the
 * properties panel, which is where "lift this one out" belongs.
 */
function defaultToneFor(kind: GuiWidgetKind, mode?: string): Tone {
  if (kind === 'input_picker') return 'sunken';
  if (kind === 'text_io' && mode !== 'output') return 'sunken';
  return 'plain';
}

/**
 * A sensible first size per kind, so a new block never lands absurdly shaped.
 *
 * A heading is one row and the full width because that is what a heading is;
 * you should not have to resize it before it looks right.
 */
function defaultSpanFor(kind: GuiWidgetKind, mode?: string): { w: number; h: number } {
  if (kind === 'divider' || kind === 'spacer') {
    // A vertical rule or gap stands between two things side by side, so it is
    // narrow and tall; a horizontal one ends a section, so it is the reverse.
    return mode === 'vertical' ? { w: 1, h: 4 } : { w: 16, h: 1 };
  }
  if (kind === 'text') {
    // Two rows for a heading, and it renders bottom-aligned inside them: the
    // spare height becomes air ABOVE it, which is a document's vertical rhythm
    // -- a section title belongs to what follows, not to what came before.
    if (mode === 'heading') return { w: 16, h: 2 };
    if (mode === 'caption') return { w: 16, h: 1 };
    return { w: 16, h: 3 };
  }
  if (kind === 'input_picker') return { w: 6, h: 2 };
  return DEFAULT_WIDGET_SPAN;
}
