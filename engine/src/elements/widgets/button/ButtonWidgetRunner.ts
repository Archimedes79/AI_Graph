import { WidgetRunner, type Widget } from '../../WidgetRunner.ts';
import { port } from '../../port.ts';
import type { Runtime } from '../../Runtime.ts';

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
export class ButtonWidgetRunner extends WidgetRunner<Record<string, never>> {
  readonly widgetKind = 'button' as const;

  /**
   * Nothing to set: a press is all it is. The count its value holds is the
   * page's, so that every press is a change it reports; the graph never reads it.
   */
  config(): Record<string, never> {
    return {};
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
