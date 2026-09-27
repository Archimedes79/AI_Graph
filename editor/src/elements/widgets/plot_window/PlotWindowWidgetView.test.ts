import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WIDGET_BUILDERS } from '@/elements/registry';
import PlotWindowWidgetView from './PlotWindowWidgetView';

const widget = WIDGET_BUILDERS.plot_window.create('Temperature');
const onPage = (value: unknown, incoming?: unknown) => renderToStaticMarkup(createElement(PlotWindowWidgetView, {
  widget, value, incoming, onChange: () => {},
}));

/** A chart draws what arrives: it has no code of its own that could draw something else. */
describe('a chart on the page', () => {
  it('draws a figure that arrives, with its title', () => {
    const html = onPage('', { kind: 'bars', title: 'People', points: [{ label: 'Oslo', value: 700 }, { label: 'Bergen', value: 290 }] });
    expect(html).toContain('bars chart of 2 points');
    expect(html).toContain('Oslo');
  });

  it('draws a list of numbers or of {label, value} points', () => {
    expect(onPage('', [3, 1, 2])).toContain('chart of 3 points');
    expect(onPage('', [{ label: 'Mon', value: 3 }])).toContain('Mon');
  });

  it('shows a string of SVG as it stands, without its scripts', () => {
    const html = onPage('', '<svg viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4"/></svg>');
    expect(html).toContain('<circle');
    expect(html).not.toContain('<script');
  });

  it('draws an empty chart before anything has arrived, and the last value it kept after', () => {
    expect(onPage('')).toContain('Empty chart, waiting for data');
    expect(onPage([5, 6])).toContain('chart of 2 points');
  });
});

describe('a chart under its port on the graph canvas', () => {
  it('draws what arrived, small', () => {
    const Preview = WIDGET_BUILDERS.plot_window.CanvasPreview!;
    const html = renderToStaticMarkup(createElement(Preview, { data: [{ label: 'Mon', value: 3 }] }));
    expect(html).toContain('Mon');
    expect(html).toContain('width="220"');
  });
});
