import { TransformingDisplay } from '../display.ts';
import type { Generation } from '../../../../generation.ts';
import { TRANSFORM_FIELDS } from '../display.ts';

/**
 * The space a chart is drawn in, and the frame left free inside it.
 *
 * Declared here, in the element, because two parties have to agree on it: the
 * app when it draws points itself, and the model when it draws its own SVG. A
 * block is resizable, so neither may think in screen pixels -- everything is
 * in these coordinates, and the box scales them. The model was told to draw
 * its own axes but not that a margin had to be left for them, so its labels
 * ran off the edge of whatever size the block happened to be.
 */
export const PLOT_VIEW = {
  width: 400,
  height: 240,
  margin: { left: 46, right: 14, top: 16, bottom: 30 },
};

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
        'a scatter, a pie, several series, your own axes, ticks, gridlines and legend.',
        '',
        'Draw it exactly like this, because the block is resizable and pixel sizes mean',
        `nothing: <svg width="100%" height="100%" viewBox="0 0 ${PLOT_VIEW.width} ${PLOT_VIEW.height}"`,
        'xmlns="http://www.w3.org/2000/svg">, and put every coordinate inside that box.',
        '',
        'Leave the frame free. Draw the plot itself only within',
        `x from ${PLOT_VIEW.margin.left} to ${PLOT_VIEW.width - PLOT_VIEW.margin.right} and`,
        `y from ${PLOT_VIEW.margin.top} to ${PLOT_VIEW.height - PLOT_VIEW.margin.bottom},`,
        `and use the ${PLOT_VIEW.margin.left} units on the left for value labels and the`,
        `${PLOT_VIEW.margin.bottom} at the bottom for category labels. Nothing may touch the`,
        'edges of the box: a label drawn there is cut off at every size. Font sizes of 11 to',
        '13 units read well at the sizes a block is given. The app draws no axes, no frame',
        'and no labels around your SVG -- everything visible is yours. Build the markup by',
        'concatenating strings.',
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
