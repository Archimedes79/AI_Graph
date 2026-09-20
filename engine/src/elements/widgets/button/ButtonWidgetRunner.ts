import { WidgetRunner, type Widget } from '../../WidgetRunner.ts';
import { port } from '../../port.ts';
import type { Runtime } from '../../Runtime.ts';

export interface ButtonConfig {
  /** How many times it has been pressed: what the page changes to say "again". Not what the graph reads. */
  count: number;
}

/**
 * A press: it starts the graph at whatever the button is wired to.
 *
 * Wired to a node's run port it says "start here" and nothing else, which is
 * what a Send button beside a message box means. Wired to nothing it starts
 * the whole graph, which is what a lone "Go" means. See `triggers.ts` for
 * what runs and what is left alone.
 *
 * What it puts on its wire is whether it was pressed *just now*: true in the
 * round its press started, false in every round something else started. So it
 * can be wired to a ◆, which it opens, or to a named input of a code node that
 * wants to know which of several events this round is. It used to emit a press
 * count, which nothing could do anything with.
 */
export class ButtonWidgetRunner extends WidgetRunner<ButtonConfig> {
  readonly widgetKind = 'button' as const;

  config(widget: Widget): ButtonConfig {
    const count = Number(widget.config.value);
    return { count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0 };
  }

  ports(widget: Widget) {
    return { inputs: [], outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'boolean')] };
  }

  /** Pressing it is the event; there is no setting that would make it not one. */
  override firesRun(): boolean {
    return true;
  }

  async execute(widget: Widget, _inputs: Record<string, unknown>, runtime: Runtime) {
    const out = `${widget.id}_out`;
    return { [out]: runtime.fired?.(out) ?? true };
  }
}
