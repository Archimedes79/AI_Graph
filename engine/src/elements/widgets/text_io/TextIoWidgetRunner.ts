import { WidgetRunner, type Widget } from '../../WidgetRunner.ts';
import { port } from '../../port.ts';
import type { RawConfig } from '../../../graph.ts';
import { asText } from './text.ts';
import { textIoRole, type TextIoRole } from './role.ts';

export interface TextIoConfig {
  value: string;
  role: TextIoRole;
}

/** A box of text: typed into, shown in, or both. */
export class TextIoWidgetRunner extends WidgetRunner<TextIoConfig> {
  readonly widgetKind = 'text_io' as const;

  config(widget: Widget): TextIoConfig {
    // Read as text: a graph saved while a reply could settle here may hold
    // an object, and that is sent as what the box shows, not "[object Object]".
    return { value: asText(widget.config.value), role: textIoRole(widget.config.mode) };
  }

  ports(widget: Widget) {
    const { role } = this.config(widget);
    const name = widget.label || widget.id;
    // The input takes anything: a chart's data wired into a box to read it
    // is an ordinary thing to want, and typing this `text` would refuse it.
    // The output is text, because that is what a box of text holds.
    const inPort = port(`${widget.id}_in`, name, 'input', 'any');
    const outPort = port(`${widget.id}_out`, name, 'output', 'text');
    if (role === 'input') return { inputs: [], outputs: [outPort] };
    if (role === 'output') return { inputs: [inPort], outputs: [] };
    return { inputs: [inPort], outputs: [outPort] };
  }

  async execute(widget: Widget, inputs: Record<string, unknown>) {
    const { role, value } = this.config(widget);
    if (role === 'output') return {};

    const incoming = inputs[`${widget.id}_in`];
    if (role === 'input') return { [`${widget.id}_out`]: value };

    // "both": what the user typed wins; an empty box falls back to what
    // arrived -- as the text it shows, because the port says text and a node
    // wired to it was told so.
    return { [`${widget.id}_out`]: value || asText(incoming) };
  }

  /**
   * What comes back around a loop is shown, not typed.
   *
   * A box that only shows keeps what arrived: that is all it holds. A box a
   * person types into keeps what they typed. In "both" the reply is shown
   * above the typing box from what the run delivered, and settling it into
   * the value made it the next message -- the model's answer sent back to the
   * model as though the person had said it.
   */
  override settle(stored: RawConfig, value: unknown): void {
    if (textIoRole(stored.mode) === 'output') stored.value = value;
  }

  /**
   * A box that sends on Enter holds a message, and a message is said once:
   * clear it when a run has delivered it, so the box is ready for the next
   * one. A box that does not send holds a setting -- a search term, a name --
   * and emptying that after every run would make the person retype it.
   */
  override clearsValueAfterRun(widget: Widget): boolean {
    return this.config(widget).role !== 'output' && this.firesRun(widget);
  }
}
