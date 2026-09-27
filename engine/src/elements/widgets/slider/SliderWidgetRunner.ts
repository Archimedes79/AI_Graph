import { WidgetRunner, type Widget } from '../../WidgetRunner.ts';
import { port } from '../../port.ts';
import { sliderRange, type SliderRange } from './range.ts';

/**
 * A number, chosen inside a range.
 *
 * `min`/`max`/`step` are the block's own settings, the same way a text box's
 * mode is: written once by a person, not generated and not wired in. What it
 * emits is always inside its own range, even if the stored value is stale
 * after a person narrows the range around it (`sliderRange`, which the page
 * reads too).
 */
export class SliderWidgetRunner extends WidgetRunner<SliderRange> {
  readonly widgetKind = 'slider' as const;

  config(widget: Widget): SliderRange {
    return sliderRange(widget.config);
  }

  /**
   * Its one output, said in words: the range it moves in. A node wired to a
   * slider is written by ✨ against its port's description, and "number" alone
   * left it to guess whether 0.5 or 5000 can arrive.
   */
  ports(widget: Widget) {
    const { min, max, step } = this.config(widget);
    const said = `a number from ${min} to ${max} in steps of ${step}`;
    return { inputs: [], outputs: [port(`${widget.id}_out`, widget.label || widget.id, 'output', 'number', false, said)] };
  }

  async execute(widget: Widget) {
    return { [`${widget.id}_out`]: this.config(widget).value };
  }
}
