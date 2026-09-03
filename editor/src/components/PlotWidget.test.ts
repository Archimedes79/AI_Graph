import { describe, it, expect } from 'vitest';
import { asDrawing, axisLabel, chartMargins, computeAxisRange, VIEW } from './PlotWidget';
import { PLOT_VIEW, PlotWindowElement } from '@engine/elements/gui/children/plot_window/element.ts';

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

describe('the frame the model is told about', () => {
  /**
   * A block is resizable, so neither the app nor a model drawing its own SVG
   * may think in screen pixels. Both lay out inside one declared frame -- and
   * the contract that teaches the model must be the same frame the app uses,
   * or generated charts put their labels where this crops them.
   */
  it('is the one the app draws in', () => {
    expect(VIEW).toEqual({ width: PLOT_VIEW.width, height: PLOT_VIEW.height });
    const margins = chartMargins(400, 240);
    expect(margins.left).toBe(PLOT_VIEW.margin.left);
    expect(margins.bottom).toBe(PLOT_VIEW.margin.bottom);
  });

  it('is spelled out for the model in the same numbers', () => {
    const contract = new PlotWindowElement().generation().contract ?? '';
    expect(contract).toContain(`viewBox="0 0 ${PLOT_VIEW.width} ${PLOT_VIEW.height}"`);
    expect(contract).toContain(String(PLOT_VIEW.margin.left));
    expect(contract).toContain(String(PLOT_VIEW.height - PLOT_VIEW.margin.bottom));
    // The reason the numbers are there at all.
    expect(contract).toContain('Leave the frame free');
  });
});
