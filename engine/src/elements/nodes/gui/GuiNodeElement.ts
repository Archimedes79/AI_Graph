import { NodeElement } from '../../NodeElement.ts';
import { type Runtime } from '../../Runtime.ts';
import { type Widget, type WidgetElement, type WidgetPresentation } from '../../WidgetElement.ts';
import type { GraphNode, Port, RawConfig } from '../../../graph.ts';
import { port } from '../../port.ts';
import { InputPickerWidgetElement, WIDGETS } from '../../widgets/roster.ts';

const BY_KIND = new Map(WIDGETS.map((e) => [e.widgetKind, e as WidgetElement<unknown>]));

/** Who a block is. Typed against `Widget`, so a misspelt name here does not compile. */
const IDENTITY: (keyof Widget)[] = ['id', 'kind', 'label'];
/** How it is drawn. Typed against `WidgetPresentation`, for the same reason. */
const PRESENTATION: (keyof WidgetPresentation)[] = ['w', 'h', 'tone', 'border', 'background'];
/** Everything else in the stored record is the element's settings. */
const OWN = new Set<string>([...IDENTITY, ...PRESENTATION]);

/**
 * Read one block out of stored JSON.
 *
 * Its settings are the record itself minus identity and presentation, so a file
 * written before configs were owned reads exactly as one written after: the
 * element picks what it knows and ignores the rest. That is why there is no
 * migration here — the shape did not change, only who is allowed to look.
 */
export function parseWidget(raw: unknown): Widget {
  const w = (raw ?? {}) as RawConfig;
  const config: RawConfig = {};
  for (const [key, value] of Object.entries(w)) {
    if (!OWN.has(key)) config[key] = value;
  }
  return {
    id: String(w.id ?? ''),
    kind: String(w.kind ?? 'text') as Widget['kind'],
    label: String(w.label ?? ''),
    w: Number(w.w ?? 8),
    h: Number(w.h ?? 4),
    tone: String(w.tone ?? 'plain'),
    ...(typeof w.border === 'boolean' ? { border: w.border } : {}),
    ...(w.background ? { background: String(w.background) } : {}),
    config,
  };
}

/** The port a block grows when it is told to catch its own failures. */
function errorPort(widget: Widget): Port {
  return port(`${widget.id}_error`, `${widget.label || widget.id} error`, 'output', 'text', false,
    'Why this block failed. Optional to wire: unwired, the page simply carries on.');
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
export class GuiNodeElement extends NodeElement<GuiConfig> {
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
      // A block told to catch its failures grows the port to put one on --
      // here, once, rather than in each of eleven block kinds. Named after the
      // block for the same reason its other ports are: a page has many.
      if (element.catchesErrors(widget)) outputs.push(errorPort(widget));
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
      const catches = element.catchesErrors(widget);
      try {
        // A display block produces nothing: what it shows is `display`'s
        // business, once everything -- loops included -- has arrived.
        if (!own.outputs.length) continue;
        // Merged, not wrapped: the block names its own ports, the same way a node
        // does. A composite that invents the key caps every block at one output.
        Object.assign(produced, await element.execute(widget, inputs, runtime));
        if (catches) produced[`${widget.id}_error`] = '';
      } catch (error) {
        // One block's failure used to cost the whole page: a picker pointed at
        // a file that had moved took every other block's output with it. Told
        // to catch, it costs that block, says why on its own port, and the
        // rest of the page still runs.
        if (!catches) throw error;
        for (const port of own.outputs) produced[port.id] = null;
        produced[`${widget.id}_error`] = error instanceof Error ? error.message : String(error);
      }
    }
    return produced;
  }

  /**
   * What each display block shows: what arrived, through the block's own
   * transform, as the page can draw it.
   *
   * A block nothing arrived at is left out rather than shown as nothing, so a
   * run that touched half a page leaves the other half as it was.
   */
  override async display(node: GraphNode, arrived: Record<string, unknown>, runtime: Runtime) {
    const shown: Record<string, unknown> = {};
    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!element || element.ports(widget).outputs.length) continue;
      const value = arrived[`${widget.id}_in`];
      if (value === undefined) continue;
      shown[widget.id] = await this.showBlock(widget, value, runtime);
    }
    return shown;
  }

  /** One block's value, as drawn. Also what the editor's ▶ Test of a block runs. */
  async showBlock(widget: Widget, value: unknown, runtime: Runtime): Promise<unknown> {
    const element = BY_KIND.get(widget.kind);
    if (!element) throw new Error(`Unknown block kind: ${widget.kind}`);
    const transformed = await element.runSnippet(widget, { value }, runtime);
    return element.displayValue(widget, transformed.value ?? value, runtime);
  }

  /** What its pickers start on. */
  override referencedPaths(node: GraphNode): string[] {
    const paths: string[] = [];
    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!(element instanceof InputPickerWidgetElement)) continue;
      const { path } = element.config(widget);
      if (path) paths.push(path);
    }
    return paths;
  }

  /** A picker with nothing chosen is a question, and its block is who to ask. */
  override runtimeRequirements(node: GraphNode) {
    const asked = [];
    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!(element instanceof InputPickerWidgetElement)) continue;
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
      const stored = raw as RawConfig;
      if (stored?.id !== widgetId) continue;
      // The block decides what arriving means: most become the value, a
      // conversation adds a turn.
      const element = BY_KIND.get(String(stored.kind) as Widget['kind']);
      if (element) element.settle(stored, value);
      else stored.value = value as never;
    }
  }
}
