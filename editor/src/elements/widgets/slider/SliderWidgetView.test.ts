import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SliderWidgetView from './SliderWidgetView';
import { SliderWidgetRunner } from '@engine/elements/widgets/slider/SliderWidgetRunner.ts';
import { parseWidget } from '@engine/elements/nodes/gui/GuiNodeRunner.ts';
import { WIDGET_BUILDERS } from '@/elements/registry';

describe('a slider on the page', () => {
  it('shows the number the run hands on, after its range was narrowed around it', async () => {
    // The bug: 80 was set, then Max became 50. The run emits 50; the page
    // went on showing 80 beside the handle.
    const widget = { ...WIDGET_BUILDERS.slider.create('Amount'), value: '80', min: 0, max: 50 };
    const emitted = (await new SliderWidgetRunner().execute(parseWidget(widget)))[`${widget.id}_out`];
    const html = renderToStaticMarkup(createElement(SliderWidgetView, { widget, value: widget.value, onChange: () => {} }));
    expect(emitted).toBe(50);
    expect(html).toContain('value="50"');
    expect(html).toMatch(/>50<\/span>/);
    expect(html).not.toContain('80');
  });

  /** What the page draws and what a run emits, for a block as it was stored. */
  async function both(stored: Record<string, unknown>) {
    const widget = { ...WIDGET_BUILDERS.slider.create('Amount'), min: undefined, max: undefined, step: undefined, ...stored };
    const runner = new SliderWidgetRunner();
    const emitted = (await runner.execute(parseWidget(widget)))[`${widget.id}_out`];
    const html = renderToStaticMarkup(createElement(SliderWidgetView, { widget: widget as never, value: widget.value, onChange: () => {} }));
    return { emitted, html, range: runner.config(parseWidget(widget)) };
  }

  it('draws the range a run uses when the block names no max', async () => {
    // The bug: the page drew 0..1 and clamped 40 to 1; the run used 0..100.
    const { emitted, html, range } = await both({ value: '40' });
    expect(range).toEqual({ value: 40, min: 0, max: 100, step: 1 });
    expect(emitted).toBe(40);
    expect(html).toContain('max="100"');
    expect(html).toContain('value="40"');
  });

  it('reads bounds written as numbers in text alike on the page and in a run', async () => {
    const { emitted, html } = await both({ value: '2', min: '5', max: '9' });
    expect(emitted).toBe(5);
    expect(html).toContain('min="5"');
    expect(html).toContain('max="9"');
    expect(html).toContain('value="5"');
  });

  it('never draws or emits NaN for bounds that are not numbers', async () => {
    const { emitted, html, range } = await both({ value: '3', min: 'abc', max: 'x', step: -2 });
    expect(range).toEqual({ value: 3, min: 0, max: 100, step: 1 });
    expect(emitted).toBe(3);
    expect(html).not.toContain('NaN');
    expect(html).toContain('step="1"');
  });
});
