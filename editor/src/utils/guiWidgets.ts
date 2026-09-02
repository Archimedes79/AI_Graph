// Keeping a gui node's ports in step with its blocks.
//
// The ports come from the **engine's** widget elements, not from a copy here.
// They are what the graph's edges attach to, so two answers to "which ports
// does this block have" is the one disagreement that silently deletes wires:
// the editor drawing a port the engine will not produce, or the engine
// producing one the editor never drew.
import type { GraphNode, GuiWidget, GuiWidgetKind, Port } from '../types/graph';
import { registry as engineRegistry } from '@engine/registry.ts';
import { parseWidget } from '@engine/elements/gui/element.ts';
import { DEFAULT_WIDGET_SPAN } from '../components/gui/layout';
import type { Tone } from '../components/gui/tone';

/**
 * The ports a node has, when they follow from its settings rather than being
 * named by hand.
 *
 * Null for a code, AI, data or output node: a person names those to match the
 * code they wrote or the prompt they gave, so the graph is the authority and
 * an element declaring `input` and `value` for them would invent a contract
 * nobody agreed to. Input and gui nodes are the other kind, and this is the
 * only place either is worked out.
 */
export function derivedNodePorts(node: GraphNode): { inputs: Port[]; outputs: Port[] } | null {
  const element = engineRegistry.node(node.node_type);
  return (element?.derivedPorts(node as never) ?? null) as { inputs: Port[]; outputs: Port[] } | null;
}

/** Return the (inputs, outputs) a single GUI widget contributes to its node. */
export function guiWidgetPorts(widget: GuiWidget): { inputs: Port[]; outputs: Port[] } {
  const element = engineRegistry.widget(widget.kind);
  if (!element) return { inputs: [], outputs: [] };
  // `parseWidget` is what turns a stored block into the shape an element reads:
  // its structural fields, and everything else as settings the element owns.
  return element.ports(parseWidget(widget)) as { inputs: Port[]; outputs: Port[] };
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
function newGuiWidgetId(): string {
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
    options: kind === 'select' ? 'Option A\nOption B' : '',
    min: kind === 'slider' ? 0 : undefined,
    max: kind === 'slider' ? 100 : undefined,
    step: kind === 'slider' ? 1 : undefined,
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
  select: 'Auswahl (Dropdown)',
  slider: 'Schieberegler',
  button: 'Knopf',
};

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
  if (kind === 'select' || kind === 'slider') return 'sunken';
  // A button is its own label -- a caption above it would just repeat the
  // text on its face -- so it stays plain, the same reason a heading does.
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
    // One row for a heading. It used to get two and hang from the bottom of
    // them, which produced air above it -- at the price of being the only text
    // on the page that did not start where every other block starts.
    if (mode === 'heading') return { w: 16, h: 1 };
    if (mode === 'caption') return { w: 16, h: 1 };
    return { w: 16, h: 3 };
  }
  if (kind === 'input_picker') return { w: 6, h: 2 };
  if (kind === 'select') return { w: 6, h: 2 };
  if (kind === 'slider') return { w: 8, h: 2 };
  if (kind === 'button') return { w: 5, h: 2 };
  return DEFAULT_WIDGET_SPAN;
}
