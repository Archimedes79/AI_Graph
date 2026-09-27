import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WIDGET_BUILDERS } from '@/elements/registry';

// A worker is what runs a chart's code, and there is none under Node: this
// stands in for it, drawing points out of rows the way such a draw() would.
vi.mock('./draw', () => ({
  draw: vi.fn(async (code: string, data: unknown) => (code.trim() && Array.isArray(data)
    ? { value: (data as { time: string; temp: number }[]).map((row) => ({ label: row.time, value: row.temp })) }
    : { value: data })),
}));

const { draw } = await import('./draw');
const { default: PlotCanvasPreview, previewDrawing } = await import('./PlotCanvasPreview');

const rows = [{ time: '08:00', temp: 12 }, { time: '09:00', temp: 14 }];
const chart = { ...WIDGET_BUILDERS.plot_window.create('Temperature'), code: 'function draw(data) { return data.map((r) => ({ label: r.time, value: r.temp })); }' };

describe('a chart under its port on the graph canvas', () => {
  it('is drawn by the chart\'s own code, as the page draws it', async () => {
    // The bug: the preview was PlotChart handed the raw rows, which it cannot
    // chart, so it stayed empty while the page drew the line.
    expect(WIDGET_BUILDERS.plot_window.CanvasPreview).toBe(PlotCanvasPreview);
    const drawn = await previewDrawing(chart, rows, 'night');
    expect(draw).toHaveBeenCalledWith(chart.code, rows, { width: 220, height: 90, scheme: 'night', dark: true });
    expect(drawn.value).toEqual([{ label: '08:00', value: 12 }, { label: '09:00', value: 14 }]);
  });

  it('shows nothing, not the raw rows, until the code has answered', () => {
    const html = renderToStaticMarkup(createElement(PlotCanvasPreview, { widget: chart, data: rows }));
    expect(html).not.toContain('08:00');
  });

  it('charts what arrived when the chart has no code of its own', () => {
    const plain = WIDGET_BUILDERS.plot_window.create('Plain');
    const html = renderToStaticMarkup(createElement(PlotCanvasPreview, { widget: plain, data: [{ label: 'Mon', value: 3 }] }));
    expect(html).toContain('Mon');
  });
});
