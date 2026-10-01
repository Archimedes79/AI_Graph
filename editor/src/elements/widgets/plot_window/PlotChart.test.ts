import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PlotChart, { asDrawing, axisLabel, chartMargins, computeAxisRange, drawingSource, labelEvery, toFigure } from './PlotChart';

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
   * be limited to the plots someone thought of here. A node upstream may hand back
   * finished SVG -- a scatter, a pie, its own legend -- and it is drawn as it
   * stands.
   */
  it('takes an SVG document as the drawing, saying it is SVG where it does not', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    expect(asDrawing(svg)).toBe(svg);
    expect(asDrawing('<svg viewBox="0 0 10 10"></svg>')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
  });

  it('is not fooled by ordinary text or by points', () => {
    expect(asDrawing('just a sentence')).toBeNull();
    expect(asDrawing([{ label: 'a', value: 1 }])).toBeNull();
    expect(asDrawing('<svgnotreally>')).toBeNull();
  });

  it('is shown as a picture, never as markup in the page -- a graph can be handed on, a chart\'s value with it', () => {
    // What a pattern that strips scripts let through: a handler without
    // quotes, HTML inside foreignObject, an entity in "javascript:".
    for (const hostile of [
      '<svg><foreignObject><img src=x onerror=alert(document.domain)></foreignObject></svg>',
      '<svg><image href=x onerror=alert(1) /></svg>',
      '<svg><a href="java&#115;cript:alert(1)">x</a></svg>',
    ]) {
      const html = renderToStaticMarkup(createElement(PlotChart, { data: hostile, width: 200, height: 100 }));
      expect(html, hostile).toMatch(/^<div[^>]*><img src="data:image\/svg\+xml;charset=utf-8,[^"<>]*"[^>]*\/><\/div>$/);
      expect(html).toContain(drawingSource(asDrawing(hostile)!).replace(/&/g, '&amp;'));
    }
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
   * The app drew into a fixed 400x240 box and scaled it into the block. At a
   * measured 1084x470 the fixed box scaled by 1.38, so an 11px label arrived
   * as 15px and a tenth of the width was letterbox.
   *
   * There is one answer now: pixels, the block's own. What remains of the old
   * frame is margins, which were always pixels.
   */
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

  it('knows a kind by its other names: a pie or a doughnut is a donut', () => {
    for (const kind of ['pie', 'doughnut', 'Donut']) expect(toFigure({ kind, points: [{ label: 'a', value: 1 }] })?.kind).toBe('donut');
    expect(toFigure({ kind: 'bar', points: [{ label: 'a', value: 1 }] })?.kind).toBe('bars');
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
    expect(toFigure([])).toBeNull();
    expect(toFigure({ points: [{ label: 'a', value: 'lots' }] })).toBeNull();
  });

  it('takes a number written as text, as a CSV cell arrives when nothing parsed it', () => {
    expect(toFigure({ kind: 'bars', title: 'Population', points: [{ label: 'India', value: '1450' }] })?.points)
      .toEqual([{ label: 'India', value: 1450 }]);
    expect(toFigure(['3', ' 1.5 ', 2])?.points.map((p) => p.value)).toEqual([3, 1.5, 2]);
    expect(toFigure(['3', ''])).toBeNull();
  });

  it('is a figure with no points when it has a title: what a node says before there is anything to plot', () => {
    expect(toFigure({ kind: 'bars', title: 'Choose a CSV file to plot.', points: [] }))
      .toEqual({ kind: 'bars', title: 'Choose a CSV file to plot.', points: [] });
  });
});

describe('a chart on the page, handed what it cannot draw', () => {
  const chart = (data: unknown) => renderToStaticMarkup(createElement(PlotChart, { data, width: 400, height: 200 }));

  it('waits while nothing has arrived', () => {
    expect(chart(undefined)).toContain('Waiting for data');
    expect(chart('')).toContain('Waiting for data');
  });

  it('says what arrived and what a chart takes: rows whose number is not called "value"', () => {
    // The canvas counted "2 rows" at the block's port while the page said
    // "Waiting for data".
    const html = chart([{ country: 'India', population: 1450 }, { country: 'China', population: 1419 }]);
    expect(html).not.toContain('Waiting for data');
    expect(html).toContain('what arrived is [{&quot;country&quot;:&quot;India&quot;,&quot;population&quot;:1450}');
    expect(html).toContain('A chart draws numbers, {&quot;label&quot;, &quot;value&quot;} points or a figure');
  });

  it('draws points whose values are numbers written as text', () => {
    expect(chart({ kind: 'bars', title: 'Population', points: [{ label: 'India', value: '1450' }] })).toContain('bars chart of 1 point"');
  });

  it('shows the title of a figure with no points: population_plotter before a file is chosen', () => {
    // Its code promises "the chart says what to do" (its output.js title); it said "Waiting for data".
    const html = chart({ kind: 'bars', title: 'Choose a CSV file to plot.', points: [] });
    expect(html).toContain('Choose a CSV file to plot.');
    expect(html).not.toContain('Waiting for data');
  });
});

describe('a chart with more bars than their names have room for', () => {
  // Twenty categories, a letter each: short enough that no name is cut.
  const points = [...'ABCDEFGHIJKLMNOPQRST'].map((label, i) => ({ label, value: i + 1 }));
  const named = (kind: string, width: number, height: number) => [...renderToStaticMarkup(createElement(PlotChart, {
    data: { kind, title: 'Population', points }, width, height,
  })).matchAll(/>([A-T])<\/text>/g)].map((match) => match[1]);

  it('names every n-th bar instead of none', () => {
    // Tool 1's chart: twenty bars in the default Chart block, and the only words in it were its title.
    expect(named('bars', 546, 266)).toEqual([...'ACEGIKMOQS']);
    expect(named('columns', 400, 200)).toEqual([...'ACEGIKMOQS']);
  });

  it('names each one where there is room', () => {
    expect(named('columns', 1200, 300)).toHaveLength(20);
    expect(labelEvery(30, 22)).toBe(1);
    expect(labelEvery(10, 22)).toBe(3);
  });
});
