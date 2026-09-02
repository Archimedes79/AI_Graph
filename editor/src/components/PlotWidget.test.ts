import { describe, it, expect } from 'vitest';
import { asDrawing, axisLabel, chartMargins, computeAxisRange } from './PlotWidget';

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
  it('is made when the block is big enough, and skipped in a canvas preview', () => {
    expect(chartMargins(400, 200).labelled).toBe(true);
    expect(chartMargins(220, 90).labelled).toBe(false);
  });
});
