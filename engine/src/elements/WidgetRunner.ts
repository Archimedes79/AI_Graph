// A widget: the element branch that sits on a page, inside a gui node.

import type { Port, RawConfig, WidgetKind } from '../graph.ts';
import { ElementRunner } from './ElementRunner.ts';
import type { Runtime } from './Runtime.ts';

/**
 * How a block sits on the page. Nothing an element ever reads to decide what
 * it does: the page draws from these, the engine only carries them.
 */
export interface WidgetPresentation {
  w: number;
  h: number;
  tone: string;
  /** Draw a frame, whatever the tone would do. Unset: the tone decides. */
  border?: boolean;
  /** A background colour of the person's own. Empty: the tone decides. */
  background?: string;
}

/**
 * A block: who it is, how it is drawn, and its element's settings.
 *
 * Flat on purpose. The three parts are named so the split is visible in the
 * type, but they are not nested: nesting would have to be undone by
 * `parseWidget` on every read anyway, since the stored file is flat, and two
 * copies of one fact are not a clearer design than one. What separates
 * presentation from settings is the type, and `PRESENTATION` in
 * `nodes/gui/GuiNodeRunner.ts` is checked against it.
 */
export interface Widget extends WidgetPresentation {
  id: string;
  kind: WidgetKind;
  label: string;
  /** The element's settings: everything the file holds that is not named above. */
  config: RawConfig;
}

export abstract class WidgetRunner<C = unknown> extends ElementRunner<Widget, C> {
  // ── What it is ────────────────────────────────────────────────────────────
  // Its kind and the ports it gives its page.

  abstract readonly widgetKind: WidgetKind;

  /** The ports this widget contributes to its gui node. */
  abstract ports(widget: Widget): { inputs: Port[]; outputs: Port[] };

  // ── Run time ──────────────────────────────────────────────────────────────
  // What the page asks of it while a graph runs.

  /**
   * Whether the *page* runs this block's body, when it draws it, rather than a
   * run running it once and storing what came back.
   *
   * True for a chart. What a chart's body most needs to be told is how big the
   * block is and which scheme the page is in, and neither exists while a graph
   * runs -- so it is run where they do, and a resize or a change of scheme
   * redraws without a run. A run then hands the page what arrived, untouched.
   *
   * False for everything else: a table's or an image's transform reshapes data
   * and has no use for the window, so it stays where a run can memoise it.
   */
  readonly bodyDrawsOnThePage: boolean = false;

  /**
   * Whether this block starts the graph when the person uses it.
   *
   * A button always does: that is all a button is. Anything else does when it
   * was told to (`run_on_change`) -- a dropdown that redraws the chart the
   * moment it changes, a message box that sends on Enter. What starts is what
   * the block is wired to, not the whole graph: see `triggers.ts`.
   */
  firesRun(widget: Widget): boolean {
    return widget.config.run_on_change === true;
  }

  /**
   * Compute this widget's output ports: `{port_id: value}`, exactly as a node
   * does one level up. Never a bare value, not even with one port — a widget
   * that wants to report *why* it produced nothing needs a second port, and a
   * bare return has nowhere to put one.
   */
  abstract execute(
    widget: Widget,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>>;

  /**
   * Keep a value that came back around a loop, for the next run.
   *
   * `stored` is the block as the graph file holds it. Most blocks simply
   * become the value; one that holds more than the last thing it was told --
   * a conversation -- says here what arriving means.
   */
  settle(stored: RawConfig, value: unknown): void {
    stored.value = value;
  }

  /**
   * Whether what this block holds was a *message* -- said once, and emptied
   * once a run has delivered it -- rather than a setting someone would have to
   * retype.
   *
   * Here and not in the browser half: what a run means for a block is the
   * block's own business, the same family as `settle` above. It was the last
   * reason the one store both hosts share had to ask a `GuiBuilder` anything.
   */
  clearsValueAfterRun(_widget: Widget): boolean {
    return false;
  }

  /** Last step before a display-only widget's value reaches the page. */
  async displayValue(_widget: Widget, value: unknown, _runtime: Runtime): Promise<unknown> {
    return value;
  }

  // ── Build time ────────────────────────────────────────────────────────────
  // What building a neighbour asks of it.

  /**
   * What a node wired into this block should hand it, in a sentence for that
   * node's ✨ Generate -- or nothing, for a block that takes whatever comes.
   *
   * Said by the block because it is a fact about the block: a chart takes
   * points, a table takes rows whose keys become its columns. It used to be
   * said by the code node, to every body it wrote, whatever that body fed.
   */
  receives(_widget: Widget): string | undefined {
    return undefined;
  }

}
