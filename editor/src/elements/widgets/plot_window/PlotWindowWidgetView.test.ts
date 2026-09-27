import { describe, it, expect } from 'vitest';
import { chartData } from './PlotWindowWidgetView';

describe('what a chart on the page hands its draw()', () => {
  it('is null before anything has arrived, as Try it and the canvas preview hand it', () => {
    // The page handed a chart with no value of its own '', and a draw()
    // written to its contract failed with "data.map is not a function".
    expect(chartData('', undefined)).toBeNull();
    expect(chartData(undefined, undefined)).toBeNull();
  });

  it('is what arrived, once something has -- even an empty text', () => {
    expect(chartData('', [1, 2])).toEqual([1, 2]);
    expect(chartData('', '')).toBe('');
    expect(chartData([3], undefined)).toEqual([3]);
  });
});
