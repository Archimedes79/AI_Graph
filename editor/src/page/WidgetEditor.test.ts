import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WIDGET_BUILDERS } from '@/elements/registry';
import type { GuiWidget } from '@/graph';
import WidgetEditor from './WidgetEditor';

const edited = (widget: GuiWidget) => renderToStaticMarkup(createElement(WidgetEditor, { widget, onChange: () => {} }));

/**
 * The selected block's editor: its label, its own settings (a lazy panel,
 * not drawn here), and how it looks. A block writes no body, so there is no
 * ✨ and no ▶ Try -- for any kind.
 */
describe('the editor of the selected block', () => {
  it('is, for a chart, its label and its look and size: nothing to start, nothing to fail', () => {
    const html = edited({ ...WIDGET_BUILDERS.plot_window.create('Temperatures'), id: 'chart' });
    expect(html).toContain('value="Temperatures"');
    expect(html).toContain('Look &amp; size');
    expect(html).not.toContain('failures');
    expect(html).not.toContain('Using this starts the graph');
    expect(html).not.toContain('Catch a failure');
  });

  it('offers a block that hands something on what starts the graph and what a failure costs', () => {
    const html = edited({ ...WIDGET_BUILDERS.input_picker.create('Folder', 'directory'), id: 'pick' });
    expect(html).toContain('Using this starts the graph');
    expect(html).toContain('Look, size &amp; failures');
    expect(html).toContain('Catch a failure instead of ending the run');
  });

  it('has no ✨ and no ▶ Try for any kind', () => {
    for (const builder of Object.values(WIDGET_BUILDERS)) {
      const html = edited({ ...builder.create('Block'), id: 'b' });
      expect(html, builder.widgetKind).not.toContain('✨');
      expect(html, builder.widgetKind).not.toContain('▶ Try');
    }
  });
});
