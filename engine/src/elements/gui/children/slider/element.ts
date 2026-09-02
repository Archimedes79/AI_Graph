import { WidgetElement, type Widget } from '../../../../element.ts';
import { port } from '../../../port.ts';

export interface SliderConfig {
  value: number;
  min: number;
  max: number;
  step: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A number, chosen inside a range.
 *
 * `min`/`max`/`step` are the block's own settings, the same way a text box's
 * mode is: written once by a person, not generated and not wired in. What it
 * emits is always inside its own range, even if the stored value is stale
 * after a person narrows the range around it.
 */
export class SliderElement extends WidgetElement<SliderConfig> {
  readonly widgetKind = 'slider' as const;

  config(widget: Widget): SliderConfig {
    const c = widget.config;
    const min = Number(c.min ?? 0);
    const max = Number(c.max ?? 100) > min ? Number(c.max ?? 100) : min + 1;
    const step = Number(c.step ?? 1) || 1;
    const stored = Number(c.value);
    return { value: clamp(Number.isFinite(stored) ? stored : min, min, max), min, max, step };
  }

  ports(widget: Widget) {
    return { inputs: [], outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'number')] };
  }

  async execute(widget: Widget) {
    return { [`${widget.id}_out`]: this.config(widget).value };
  }
}
