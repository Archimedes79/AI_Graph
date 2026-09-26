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
});
