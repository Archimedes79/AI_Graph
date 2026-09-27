import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TransformingDisplayPanel from './TransformingDisplayPanel';
import type { TransformingDisplayGuiBuilder } from './TransformingDisplayGuiBuilder';
import type { WidgetSteps } from '../WidgetGuiBuilder';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { widgetFields } from '@/authoring/generation';
import type { GuiWidget } from '@/graph';

const KINDS = ['plot_window', 'table', 'image_view'] as const;

/** What only the block editor hands a panel in steps; here nothing is run or asked. */
const steps: WidgetSteps = {
  feeds: '"Rows maker" (port "rows")',
  fromGraph: async () => ({ values: {}, said: '' }),
  tryIt: async () => ({ status: 'success' }),
  renderResult: () => null,
  preview: createElement('button', null, 'What ✨ sends'),
};

function panel(widget: GuiWidget): string {
  const builder = WIDGET_BUILDERS[widget.kind] as TransformingDisplayGuiBuilder;
  return renderToStaticMarkup(createElement(TransformingDisplayPanel, {
    builder, widget, onUpdate: () => {}, fields: widgetFields(widget, () => {}),
    generating: false, onGenerate: () => {}, steps,
  }));
}

/** The ▶ Try it button, as drawn. */
const tryButton = (html: string) => /<button[^>]*>▶ Try it<\/button>/.exec(html)?.[0] ?? '';

/** Text as React writes it into markup. */
const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('a chart, a table or an image, built in the four steps', () => {
  it.each(KINDS)('%s: one example from the graph or a file, what it shows said, the task, and code with ✨ and Try it', (kind) => {
    const builder = WIDGET_BUILDERS[kind] as TransformingDisplayGuiBuilder;
    const html = panel({ ...builder.create('Block'), id: 'block' });
    for (const step of ['What comes in', 'What comes out', 'What should it do?', 'Code']) expect(html, step).toContain(`aria-label="${step}"`);
    expect(html).toContain('It is handed what &quot;Rows maker&quot; (port &quot;rows&quot;) hands on.');
    expect(html).toContain('⟳ From the graph');
    expect(html).toContain('📂 From a file…');
    // Step 2 is said, not asked: the kind's one sentence, and no field.
    expect(html).toContain(escaped(builder.shows));
    expect(html).toContain('✨ Generate');
    expect(html).toContain('What ✨ sends');
    // Before any code or example exists, Try it shows what arrives as it is.
    expect(tryButton(html)).not.toBe('');
    expect(tryButton(html)).not.toContain('disabled');
  });

  it('says why Try it waits while the example is not an object keyed by what arrives', () => {
    const table = { ...WIDGET_BUILDERS.table.create('Rows'), id: 'rows', example: '[1, 2]' };
    expect(tryButton(panel(table))).toContain('disabled');
  });
});
