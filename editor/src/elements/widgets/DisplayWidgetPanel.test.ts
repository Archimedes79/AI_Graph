import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DisplayWidgetPanel from './DisplayWidgetPanel';
import { WIDGET_BUILDERS } from '@/elements/registry';

/** A chart, a table and an image: nothing to write, one sentence of what it shows. */
describe('the dialog of a block that shows what arrives', () => {
  it.each(['plot_window', 'table', 'image_view'] as const)('%s says what it shows, and offers no code', (kind) => {
    const builder = WIDGET_BUILDERS[kind];
    const widget = builder.create('Block');
    const html = renderToStaticMarkup(createElement(DisplayWidgetPanel, { builder, widget, onUpdate: () => {} }));
    expect(html).toContain('Shows what arrives, which should be ');
    expect(html).toContain('code node wired in before it');
    expect(html).not.toContain('✨');
    expect(html).not.toContain('▶ Try');
  });
});
