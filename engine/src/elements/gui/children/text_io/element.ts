import { WidgetElement, type Widget } from '../../../../element.ts';
import { port } from '../../../port.ts';

export type TextIoRole = 'input' | 'output' | 'both';

export interface TextIoConfig {
  value: string;
  role: TextIoRole;
}

/** A box of text: typed into, shown in, or both. */
export class TextIoElement extends WidgetElement<TextIoConfig> {
  readonly widgetKind = 'text_io' as const;

  config(widget: Widget): TextIoConfig {
    const role = String(widget.config.mode ?? 'both');
    return {
      value: String(widget.config.value ?? ''),
      role: (['input', 'output', 'both'].includes(role) ? role : 'both') as TextIoRole,
    };
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

    // "both": what the user typed wins; an empty box falls back to what arrived.
    if (value) return { [`${widget.id}_out`]: value };
    if (Array.isArray(incoming)) return { [`${widget.id}_out`]: incoming.map(String).join('\n') };
    return { [`${widget.id}_out`]: incoming ?? '' };
  }
}
