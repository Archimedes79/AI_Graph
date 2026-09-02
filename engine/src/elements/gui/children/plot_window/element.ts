import { TransformingDisplay } from '../display.ts';
import type { Generation } from '../../../../generation.ts';
import { TRANSFORM_FIELDS } from '../display.ts';

/** Points to draw: a list of numbers, or of {label, value}. */
export class PlotWindowElement extends TransformingDisplay {
  readonly widgetKind = 'plot_window' as const;

  /**
   * Two ways to answer, and the second is why this is not a fixed chart.
   *
   * Points get the built-in bar or line chart, axes and labels included. Any
   * other plot -- a scatter, a pie, two series, a legend of its own -- is
   * written as SVG by the transform itself and drawn as it stands, so what can
   * be plotted is what the model can write rather than what was foreseen here.
   *
   * A plotting library is still out: none is installed, the sandbox has no
   * package manager, and a library's figure is not JSON anyway. Writing SVG
   * needs nothing but string concatenation.
   */
  override generation(): Generation {
    return {
      kind: 'code', fields: TRANSFORM_FIELDS,
      contract: [
        'Must expose run(inputs) -> object, receiving {"value": <raw incoming data>}',
        'and returning {"value": <what to show>}. There are two ways to answer.',
        '',
        '1. Points, for an ordinary chart: a list of numbers, or a list of',
        '{"label": string, "value": number}. The app draws these as a bar or line chart',
        'with a value axis, category labels and a zero line. Return this when a plain',
        'chart of one series is what was asked for.',
        '',
        '2. A finished SVG document, as a string starting with "<svg", for anything else:',
        'a scatter, a pie, several series, your own axes, ticks, gridlines and legend. Give',
        'it width="100%" height="100%" and a viewBox so it scales to the size of the block,',
        'and draw the axis lines, tick labels and legend yourself: the app draws none of its',
        'own around it. Build the markup by concatenating strings.',
        '',
        'Either way, answer for empty or missing input too -- an empty list, or an SVG of',
        'empty axes -- rather than throwing, so the block shows a waiting chart instead of',
        'an error. Do NOT import plotting or third-party libraries: the code runs in a',
        'sandbox with only the Node standard library. Scripts and event handlers inside the',
        'SVG are stripped before it is drawn.',
      ].join('\n'),
      inputs: ['value'], outputs: ['value'],
      guard: 'Please describe the chart you want first.',
      success: '✅ Chart generated!',
    };
  }
}
