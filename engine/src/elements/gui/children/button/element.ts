import { WidgetElement, type Widget } from '../../../../element.ts';
import { port } from '../../../port.ts';

export interface ButtonConfig {
  /** How many times it has been pressed since the graph last read it. */
  count: number;
}

/**
 * A press, counted.
 *
 * A run is one pass through the whole graph, not a live channel into it —
 * pressing this does not itself start a run, the way it would in a system
 * built around events. What it gives a downstream node is the number of
 * presses since the count was last read: a code node comparing that against
 * what it saw last time can tell whether *this* run follows a press, and by
 * how many.
 */
export class ButtonElement extends WidgetElement<ButtonConfig> {
  readonly widgetKind = 'button' as const;

  config(widget: Widget): ButtonConfig {
    const count = Number(widget.config.value);
    return { count: Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0 };
  }

  ports(widget: Widget) {
    return { inputs: [], outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'number')] };
  }

  async execute(widget: Widget) {
    return { [`${widget.id}_out`]: this.config(widget).count };
  }
}
