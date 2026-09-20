import { describe, it, expect } from 'vitest';
import { asDrawing, axisLabel, chartMargins, computeAxisRange, toFigure } from './PlotChart';
import { PLOT_VIEW, PlotWindowWidgetRunner } from '@engine/elements/widgets/plot_window/PlotWindowWidgetRunner.ts';

describe('computeAxisRange', () => {
  it('includes 0 in the range for all-positive data', () => {
    expect(computeAxisRange([5, 2])).toEqual({ min: 0, max: 5, range: 5 });
  });

  it('includes 0 in the range for all-negative data', () => {
    // Regression: max must include 0 symmetrically with min, otherwise the
    // zero baseline falls outside [min, max] and bars clip/misrender.
    const { min, max, range } = computeAxisRange([-5, -2]);
    expect(min).toBe(-5);
    expect(max).toBe(0);
    expect(range).toBe(5);
  });

  it('spans both signs unchanged', () => {
    expect(computeAxisRange([-3, 4])).toEqual({ min: -3, max: 4, range: 7 });
  });

  it('guards against a zero-size range', () => {
    const { min, max, range } = computeAxisRange([0, 0]);
    expect(min).toBe(0);
    expect(max).toBeGreaterThan(0);
    expect(range).toBeGreaterThan(0);
  });
});

describe('a chart the model drew itself', () => {
  /**
   * The point of this path: a bar chart is one plot, and the block should not
   * be limited to the plots someone thought of here. A transform may hand back
   * finished SVG -- a scatter, a pie, its own legend -- and it is drawn as it
   * stands.
   */
  it('takes an SVG document as the drawing', () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    expect(asDrawing(svg)).toBe(svg);
  });

  it('is not fooled by ordinary text or by points', () => {
    expect(asDrawing('just a sentence')).toBeNull();
    expect(asDrawing([{ label: 'a', value: 1 }])).toBeNull();
    expect(asDrawing('<svgnotreally>')).toBeNull();
  });

  it('strips what would run, since a graph can be handed on', () => {
    const hostile = '<svg onload="steal()"><script>steal()</script><a href="javascript:steal()">x</a></svg>';
    const safe = asDrawing(hostile)!;
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('onload');
    expect(safe).not.toContain('javascript:');
    expect(safe).toContain('<svg');
  });
});

describe('axis labels', () => {
  it('shorten numbers that would not fit beside an axis', () => {
    expect(axisLabel(1_430_000_000)).toBe('1.4G');
    expect(axisLabel(1_410_000)).toBe('1.4M');
    expect(axisLabel(1_430)).toBe('1.4k');
    expect(axisLabel(42)).toBe('42');
  });
});

describe('room for axes', () => {
  it('is made at any size a block on a page has', () => {
    expect(chartMargins(400, 200).labelled).toBe(true);
    // The size a mismeasured block reported. It has room for axes; the old
    // threshold sat just above it, which is why a wide chart drew none.
    expect(chartMargins(188, 90).labelled).toBe(true);
  });

  it('is skipped only where text could not be read', () => {
    expect(chartMargins(120, 60).labelled).toBe(false);
  });
});


describe('one coordinate system: the block', () => {
  /**
   * There used to be two answers to "how big is a chart?" and they disagreed.
   * The app drew into a fixed 400x240 box and scaled it into the block, while
   * the body contract told an author to lay out for the size they were handed.
   * At a measured 1084x470 the fixed box scaled by 1.38, so an 11px label
   * arrived as 15px and a tenth of the width was letterbox.
   *
   * There is one answer now: pixels, the block's own. What remains of the old
   * frame is margins, which were always pixels.
   */
  it('keeps no drawing space of its own to scale from', () => {
    expect(Object.keys(PLOT_VIEW)).toEqual(['margin']);
  });

  it('tells a body the same thing: lay out for the window you are handed', () => {
    const contract = new PlotWindowWidgetRunner().generation().contract ?? '';
    expect(contract).toContain('draw(data, window)');
    expect(contract).toContain('window.width');
    expect(contract).toContain('window.height');
    // And that the empty case is the same function, not a state the app owns.
    expect(contract).toMatch(/null before anything/);
  });

  it('gives a long number more room to its left than a short one', () => {
    // '1.4G' and '128500' do not need the same margin. One constant for both
    // either crops the long one or wastes the short one's space.
    const short = chartMargins(600, 300, 2);
    const long = chartMargins(600, 300, 9);
    expect(long.left).toBeGreaterThan(short.left);
    // ...but never so much that the chart is squeezed out of its own block.
    expect(chartMargins(300, 300, 40).left).toBeLessThanOrEqual(90);
  });
});

describe('a figure: what a node sends a chart', () => {
  /**
   * The point of the shape. Choosing bars or a donut is a *value*, so it can
   * come down a wire from a dropdown on the page — which is what a node
   * writing finished SVG could never follow, since a node cannot know the
   * window and does not run when it changes.
   */
  it('takes the kind and the title from the object, so a wire can set them', () => {
    const figure = toFigure({ kind: 'donut', title: 'Population', points: [{ label: 'a', value: 1 }] });
    expect(figure).toEqual({ kind: 'donut', title: 'Population', points: [{ label: 'a', value: 1 }] });
  });

  it('still takes a bare list, which is the shortest thing that works', () => {
    expect(toFigure([1, 2, 3])?.points).toEqual([
      { label: '0', value: 1 }, { label: '1', value: 2 }, { label: '2', value: 3 },
    ]);
  });

  it('chooses a shape when nobody asked for one: columns, or a line once they would not fit', () => {
    expect(toFigure([1, 2, 3])?.kind).toBe('columns');
    expect(toFigure(Array.from({ length: 30 }, (_, i) => i))?.kind).toBe('line');
  });

  it('ignores a kind it cannot draw rather than drawing nothing', () => {
    expect(toFigure({ kind: 'sunburst', points: [{ label: 'a', value: 1 }] })?.kind).toBe('columns');
  });

  it('reads a figure that arrived as JSON text, as a body or a node may send it', () => {
    expect(toFigure('{"kind":"bars","points":[{"label":"a","value":2}]}')?.kind).toBe('bars');
  });

  it('is not a figure when there is nothing to plot', () => {
    expect(toFigure(null)).toBeNull();
    expect(toFigure('just a sentence')).toBeNull();
    expect(toFigure({ points: [] })).toBeNull();
    expect(toFigure({ points: [{ label: 'a', value: 'lots' }] })).toBeNull();
  });
});
