import { NodeRunner, type TextFile, type WhatRuns } from '../../NodeRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { type Widget, type WidgetRunner, type WidgetPresentation } from '../../WidgetRunner.ts';
import type { GraphNode, Port, RawConfig } from '../../../graph.ts';
import { port } from '../../port.ts';
import type { Problem } from '../../../execution/wiring.ts';
import { InputPickerWidgetRunner, WIDGETS } from '../../widgets/roster.ts';

const BY_KIND = new Map(WIDGETS.map((e) => [e.widgetKind, e as WidgetRunner<unknown>]));

/** Who a block is. Typed against `Widget`, so a misspelt name here does not compile. */
const IDENTITY: (keyof Widget)[] = ['id', 'kind', 'label'];
/** How it is drawn. Typed against `WidgetPresentation`, for the same reason. */
const PRESENTATION: (keyof WidgetPresentation)[] = ['w', 'h', 'tone', 'border', 'background'];
/** Everything else in the stored record is the element's settings. */
const OWN = new Set<string>([...IDENTITY, ...PRESENTATION]);

/**
 * Read one block out of stored JSON.
 *
 * Its settings are the record itself minus identity and presentation: the
 * element picks what it knows and ignores the rest.
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
export class GuiNodeRunner extends NodeRunner<GuiConfig> {
  readonly nodeType = 'gui' as const;

  config(node: GraphNode): GuiConfig {
    const raw = node.config.gui_widgets;
    return { widgets: Array.isArray(raw) ? raw.map(parseWidget) : [] };
  }

  /** Its blocks, in order: `page.json`, the page as a file of its own. */
  override texts(): readonly TextFile[] {
    return [{ field: 'gui_widgets', file: 'page.json', json: true }];
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
      // block for the same reason its other ports are: a page has many. Only
      // a block that hands something on can fail in a run (`execute`); one
      // that only shows -- a text box switched to "Output" -- kept a port the
      // editor no longer offers to take away, which sent `{}` on every run.
      if (own.outputs.length && element.catchesErrors(widget)) outputs.push(errorPort(widget));
    }
    return { inputs, outputs };
  }

  override blocks(node: GraphNode): Record<string, unknown>[] {
    const raw = node.config.gui_widgets;
    return Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  }

  override setBlocks(node: GraphNode, blocks: Record<string, unknown>[]): void {
    node.config.gui_widgets = blocks;
  }

  override readonly isMemory = true;

  override readonly hasInterface = true;

  /**
   * A block that starts the graph does so on its `_out` port: what the page
   * names when it fires. One it has -- a block that only shows hands nothing
   * on, and starts nothing, whatever it was once told.
   */
  override eventPorts(node: GraphNode): string[] {
    return this.config(node).widgets.flatMap((widget) => {
      const element = BY_KIND.get(widget.kind);
      const out = `${widget.id}_out`;
      return element?.firesRun(widget) && element.ports(widget).outputs.some((port) => port.id === out) ? [out] : [];
    });
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
   * What each display block shows: what arrived, as the page can draw it --
   * an image's path read into a picture (`WidgetRunner.displayValue`).
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
      shown[widget.id] = await element.displayValue(widget, value, runtime);
    }
    return shown;
  }

  /** A picker with nothing chosen is a question, and its block is who to ask. */
  override runtimeRequirements(node: GraphNode) {
    const asked = [];
    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!(element instanceof InputPickerWidgetRunner)) continue;
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

  // ── Build time ────────────────────────────────────────────────────────────

  /**
   * A block's ports are named after its id, so an id that is missing or
   * shared is two blocks on one port; and a kind nobody knows draws nothing.
   * A block runs no code, so there is nothing else in it to get wrong.
   */
  override problems(node: GraphNode, _elements: unknown, where: string): Problem[] {
    const found: Problem[] = [];
    const seen = new Set<string>();
    for (const block of this.config(node).widgets) {
      if (!block.id) {
        found.push({ where, problem: `A "${block.kind}" block has no id.`, fix: 'Give every block an id; its ports are named after it ("<id>_in", "<id>_out").' });
      } else if (seen.has(block.id)) {
        found.push({ where, problem: `More than one block has the id "${block.id}".`, fix: 'Give every block on the page its own id.' });
      }
      seen.add(block.id);
      if (!BY_KIND.has(block.kind)) {
        found.push({
          where: `${where}, block "${block.id}"`,
          problem: `Unknown block kind "${block.kind}".`,
          fix: `Use one of: ${[...BY_KIND.keys()].join(', ')}.`,
        });
      }
    }
    return found;
  }

  /**
   * The page's blocks, and every kind of block with what it says of itself
   * (`WidgetRunner.graphAuthorNote`): a kind is listed by being registered,
   * so the prompt cannot leave one out, as its hand-kept list once left out
   * the spacer.
   */
  override graphAuthorNote(): string {
    const kinds = [...BY_KIND.values()].map((element) => {
      const note = element.graphAuthorNote();
      return `  - ${element.widgetKind}${note ? `: ${note}` : ''}`;
    });
    return 'A graph has at most one gui node: its page, which holds every block. '
      + 'config.gui_widgets is the list of blocks on the page. A block is {"id", "kind", "label", "w" (1-16 columns), '
      + '"h" (rows), ...}. The page\'s ports are DERIVED from its blocks, not taken from this document: every block '
      + 'contributes "<block id>_out", "<block id>_in", or both, "<id>" standing for its id. A block has no code of its '
      + 'own: what reshapes a value before a block shows it, or keeps only some of the files a folder lists, is a code '
      + `node wired in between. The kinds:\n${kinds.join('\n')}`;
  }

  override whatRuns(): WhatRuns {
    return this.engineRuns('Hands on what each block holds -- a pressed button as true for that round -- and shows what arrives.');
  }

  /**
   * A page is its blocks: a bundle holding one with blocks needs the page, and
   * one whose blocks are all gone has nothing to draw -- a tool without a
   * page, run on the terminal. Its blocks run no code, and so ask no model.
   */
  override deployNeeds(node: GraphNode) {
    return { needsInterface: this.config(node).widgets.length > 0, asksAi: false };
  }

  /** What its pickers start on. */
  override referencedPaths(node: GraphNode): string[] {
    const paths: string[] = [];
    for (const widget of this.config(node).widgets) {
      const element = BY_KIND.get(widget.kind);
      if (!(element instanceof InputPickerWidgetRunner)) continue;
      const { path } = element.config(widget);
      if (path) paths.push(path);
    }
    return paths;
  }
}
