import { NodeElement, type Runtime, type Widget, type WidgetElement } from '../../element.ts';
import type { GraphNode, Port, RawConfig } from '../../graph.ts';
import { InputPickerElement, WIDGET_ELEMENTS } from './children/index.ts';

const BY_KIND = new Map(WIDGET_ELEMENTS.map((e) => [e.widgetKind, e as WidgetElement<unknown>]));

/** The structural fields of a block; everything else belongs to its element. */
const STRUCTURAL = new Set(['id', 'kind', 'label', 'w', 'h', 'tone']);

/**
 * Read one block out of stored JSON.
 *
 * Its settings are the record itself minus the structural fields, so a file
 * written before configs were owned reads exactly as one written after: the
 * element picks what it knows and ignores the rest. That is why there is no
 * migration here — the shape did not change, only who is allowed to look.
 */
export function parseWidget(raw: unknown): Widget {
  const w = (raw ?? {}) as RawConfig;
  const config: RawConfig = {};
  for (const [key, value] of Object.entries(w)) {
    if (!STRUCTURAL.has(key)) config[key] = value;
  }
  return {
    id: String(w.id ?? ''),
    kind: String(w.kind ?? 'text') as Widget['kind'],
    label: String(w.label ?? ''),
    w: Number(w.w ?? 8),
    h: Number(w.h ?? 4),
    tone: String(w.tone ?? 'plain'),
    config,
  };
}

export interface GuiConfig {
  widgets: Widget[];
}

/**
 * The node that carries the graph's interface.
 *
 * A composite: it holds blocks, and running it means running each of them and
 * merging what they produced. Its ports are derived from theirs — nobody wires
 * a gui node, they wire the block inside it — which is what keeps the page and
 * the graph from ever disagreeing about what exists.
 */
export class GuiElement extends NodeElement<GuiConfig> {
  readonly nodeType = 'gui' as const;
  override readonly isMemory = true;
  override readonly hasInterface = true;

  config(node: GraphNode): GuiConfig {
    const raw = node.config.gui_widgets;
    return { widgets: Array.isArray(raw) ? raw.map(parseWidget) : [] };
  }

  /** Derived: the union of its blocks' ports. Nobody names these by hand. */
  override derivedPorts(node: GraphNode): { inputs: Port[]; outputs: Port[] } {
    const inputs: Port[] = [];
    const outputs: Port[] = [];
    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!element) continue;
      const own = element.ports(widget);
      inputs.push(...own.inputs);
      outputs.push(...own.outputs);
    }
    return { inputs, outputs };
  }

  override deployNeeds() {
    // A gui node *is* the interface, so a bundle holding one needs the page.
    return { needsInterface: true };
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const produced: Record<string, unknown> = {};

    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!element) throw new Error(`Unknown block kind: ${widget.kind}`);

      const own = element.ports(widget);
      if (!own.outputs.length) {
        // A display block: reshape what arrived and hand it back on the input
        // it arrived on, because there is no downstream port to carry it.
        const inId = `${widget.id}_in`;
        const transformed = await element.runSnippet(widget, { value: inputs[inId] }, runtime);
        inputs[inId] = await element.displayValue(widget, transformed.value ?? inputs[inId], runtime);
        continue;
      }
      // Merged, not wrapped: the block names its own ports, the same way a node
      // does. A composite that invents the key caps every block at one output.
      Object.assign(produced, await element.execute(widget, inputs, runtime));
    }
    return produced;
  }

  /** A picker with nothing chosen is a question, and its block is who to ask. */
  override runtimeRequirements(node: GraphNode) {
    const asked = [];
    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!(element instanceof InputPickerElement)) continue;
      const settings = element.config(widget);
      if (settings.path) continue;
      asked.push({
        key: `${node.id}::${widget.id}`,
        label: widget.label || widget.id,
        kind: (settings.directory ? 'directory' : 'file') as 'directory' | 'file',
        direction: 'input' as const,
        current: '',
      });
    }
    return asked;
  }

  override applyRuntimeValue(node: GraphNode, widgetId: string | null, value: string): void {
    const widgets = node.config.gui_widgets;
    if (!widgetId || !Array.isArray(widgets)) return;
    for (const raw of widgets) {
      if ((raw as RawConfig)?.id === widgetId) (raw as RawConfig).value = value;
    }
  }

  /** A block that closes a loop keeps the fresh value, ready for the next run. */
  override settleMemory(node: GraphNode, portId: string, value: unknown): void {
    const widgets = node.config.gui_widgets;
    if (!Array.isArray(widgets)) return;
    const widgetId = portId.replace(/_in$/, '');
    for (const raw of widgets) {
      if ((raw as RawConfig)?.id === widgetId) (raw as RawConfig).value = value as never;
    }
  }
}
