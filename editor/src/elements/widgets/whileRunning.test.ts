import { describe, it, expect } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WidgetViewProps } from './WidgetView';
import SelectWidgetView from './select/SelectWidgetView';
import SliderWidgetView from './slider/SliderWidgetView';
import InputPickerWidgetView from './input_picker/InputPickerWidgetView';
import { WIDGET_BUILDERS } from '@/elements/registry';

/**
 * A block that starts the graph, while a round runs: it waits, as a button
 * does. Used meanwhile, what it was set to was kept -- and the event dropped,
 * so a dropdown showed a choice the chart beside it had never been drawn for.
 */

const blocks: [string, ComponentType<WidgetViewProps>, 'select' | 'slider' | 'input_picker', RegExp][] = [
  ['a dropdown', SelectWidgetView, 'select', /<select[^>]*>/],
  ['a slider', SliderWidgetView, 'slider', /<input type="range"[^>]*>/],
  ['a file picker', InputPickerWidgetView, 'input_picker', /<input[^>]*>|<button[^>]*>📂/g],
];

describe('a file picker that starts the graph, filled in already', () => {
  it('says how to start it with what it holds -- and only where it starts the graph and holds something', () => {
    const drawn = (starts: boolean, value: string, mode = 'file') => renderToStaticMarkup(createElement(InputPickerWidgetView, {
      widget: { ...WIDGET_BUILDERS.input_picker.create('csv', 'CSV file', mode), extensions: '.csv', run_on_change: starts },
      value, onChange: () => {}, onTrigger: () => {},
    }));
    expect(drawn(true, 'data/population.csv')).toContain('Allowed: .csv · Press Enter to use this file');
    expect(drawn(true, 'data/stories', 'directory')).toContain('Press Enter to use this folder');
    expect(drawn(false, 'data/population.csv')).not.toContain('Press Enter');
    expect(drawn(true, '')).not.toContain('Press Enter');
  });
});

describe('a block that starts the graph, while a round runs', () => {
  it.each(blocks)('%s waits for it -- and one that does not start the graph does not', (_what, View, kind, control) => {
    const drawn = (starts: boolean, busy: boolean) => renderToStaticMarkup(createElement(View, {
      widget: { ...WIDGET_BUILDERS[kind].create('block', 'Block'), options: 'a, b', run_on_change: starts },
      value: 'a', onChange: () => {}, onTrigger: () => {}, busy,
    }));
    const controls = (html: string) => html.match(new RegExp(control.source, 'g')) ?? [];
    expect(controls(drawn(true, true)).length).toBeGreaterThan(0);
    for (const one of controls(drawn(true, true))) expect(one).toContain('disabled');
    for (const one of controls(drawn(true, false))) expect(one).not.toContain('disabled');
    for (const one of controls(drawn(false, true))) expect(one).not.toContain('disabled');
  });
});
