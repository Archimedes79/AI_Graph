import { WidgetElement, type Widget } from '../../WidgetElement.ts';
import { port } from '../../port.ts';

export interface ButtonConfig {
  /** How many times it has been pressed since the graph last read it. */
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
 * It still counts its presses and emits the count, for a node that wants to
 * know how often rather than merely when.
 */
export class ButtonWidgetElement extends WidgetElement<ButtonConfig> {
  readonly widgetKind = 'button' as const;

  config(widget: Widget): ButtonConfig {
    const count = Number(widget.config.value);
    return { count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0 };
  }

  ports(widget: Widget) {
    return { inputs: [], outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'number')] };
  }

  /** Pressing it is the event; there is no setting that would make it not one. */
  override firesRun(): boolean {
    return true;
  }

  async execute(widget: Widget) {
    return { [`${widget.id}_out`]: this.config(widget).count };
  }
}
