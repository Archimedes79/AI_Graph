import { TransformingDisplayRunner } from '../TransformingDisplayRunner.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { TRANSFORM_FIELDS } from '../TransformingDisplayRunner.ts';
import { checkPlot } from './check.ts';

export { PLOT_VIEW } from './view.ts';

/** Points to draw: a list of numbers, or of {label, value}. */
export class PlotWindowWidgetRunner extends TransformingDisplayRunner {
  readonly widgetKind = 'plot_window' as const;

  // ── Run time ──────────────────────────────────────────────────────────────

  /**
   * The page draws this one itself.
   *
   * A chart's body is the only one whose answer depends on things a run cannot
   * know: how big the block is, and which colour scheme the page is in. So it
   * runs where those are — in the browser, in a worker, on every redraw — and a
   * run hands the page what arrived and nothing more. See
   * `editor/src/elements/widgets/plot_window/draw.ts`.
   */
  override readonly bodyDrawsOnThePage = true;

  // ── Build time ────────────────────────────────────────────────────────────

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
        'Must expose draw(data, window) -> what to show.',
        '',
        '`data` is what arrived at the block, and is null before anything has. Draw that',
        'case too -- empty axes, or an empty list of points -- rather than throwing: it is',
        'what the block shows before the graph has ever run, and it is the same function.',
        '',
        '`window` is { width, height, scheme, dark }: the block\'s real size in pixels as it',
        'is on screen right now, the name of the page\'s colour scheme, and whether that',
        'scheme is a dark one. draw is called again whenever any of them changes, so a',
        'resize or a change of scheme redraws with no run at all -- lay the chart out for',
        'the size you are given rather than for a fixed one.',
        '',
        'There are two ways to answer.',
        '',
        '1. Points, for an ordinary chart: a list of numbers, or a list of',
        '{"label": string, "value": number}. The app draws these as a bar or line chart',
        'with a value axis, category labels and a zero line. Return this when a plain',
        'chart of one series is what was asked for.',
        '',
        '2. A finished SVG document, as a string starting with "<svg", for anything else:',
        'a scatter, a pie, several series, your own axes, ticks, gridlines and legend.',
        '',
        'Open it as <svg width="100%" height="100%" viewBox="0 0 W H"',
        'xmlns="http://www.w3.org/2000/svg">, with W and H the window.width and',
        'window.height you were handed, and put every coordinate inside that box. You are',
        'drawing at the size the block actually is, so a label is as many pixels as it',
        'looks: leave about 40 on the left for value labels and 24 at the bottom for',
        'category ones, and nothing may touch the edges -- a label drawn there is cut off.',
        'Font sizes of 11 to 13 read well. The app draws no axes, no frame and no labels',
        'around your SVG: everything visible is yours. Build the markup by concatenating',
        'strings.',
        '',
        'Colour. window.dark says which way the scheme is up, so you may decide on it.',
        'Beyond that, text, axes and gridlines drawn with fill="currentColor" /',
        'stroke="currentColor" (and an opacity for the quieter ones) are readable on every',
        'scheme, and these CSS variables resolve inside your SVG and follow it: var(--plot-1)',
        '… var(--plot-8) are series colours chosen to be told apart, var(--ui-accent) is the',
        'accent of the page, var(--ui-muted) quieter text, var(--ui-line) a hairline. Use',
        'them where a colour is only there to tell things apart; use a colour of your own',
        'wherever the colour MEANS something -- red for a limit, green for ok -- or was asked',
        'for. Do not paint a background rectangle: the block has one.',
        '',
        'Do NOT import anything: the code runs in a worker with no modules, no network and',
        'no DOM -- data in, points or a string of SVG out. Scripts and event handlers inside',
        'the SVG are stripped before it is drawn.',
      ].join('\n'),
      inputs: ['value'], outputs: ['value'],
      // Looked at before anyone sees it: see check.ts.
      check: checkPlot,
      /**
       * The page runs `draw(data, window)`; the probe has neither a page nor a
       * block, so it wraps it in what the sandbox does call and hands it a
       * window of a plausible size. The numbers are a stand-in and the check
       * that follows knows it: it reads the viewBox the body itself declared,
       * not these.
       *
       * A body that still defines `run` -- every chart written before this --
       * is left exactly as it is.
       */
      probeWith: (body) => (/\bfunction\s+run\b|\brun\s*=/.test(body) ? body : [
        body,
        'function run(inputs) {',
        "  const window = { width: 640, height: 360, scheme: 'night', dark: true };",
        '  const drawn = draw(inputs.value, window);',
        "  return drawn && typeof drawn === 'object' && 'value' in drawn ? drawn : { value: drawn };",
        '}',
      ].join('\n')),
      guard: 'Please describe the chart you want first.',
      success: '✅ Chart generated!',
    };
  }
}
