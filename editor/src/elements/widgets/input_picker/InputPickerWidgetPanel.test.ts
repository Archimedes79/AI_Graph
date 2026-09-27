import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InputPickerWidgetPanel from './InputPickerWidgetPanel';
import type { InputPickerWidgetGuiBuilder } from './InputPickerWidgetGuiBuilder';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { widgetFields } from '@/authoring/generation';
import type { GuiWidget } from '@/graph';

const builder = WIDGET_BUILDERS.input_picker as InputPickerWidgetGuiBuilder;

/** What only the block editor can hand a panel in steps: here, nothing is run. */
const steps = {
  feeds: '',
  tryIt: async () => ({ status: 'success' }),
  renderResult: () => null,
};

function panel(widget: GuiWidget): string {
  return renderToStaticMarkup(createElement(InputPickerWidgetPanel, {
    builder, widget, onUpdate: () => {}, generation: builder.generation, fields: widgetFields(widget, () => {}),
    generating: false, onGenerate: () => {}, steps,
  }));
}

/** The "every file it lists" box, as drawn. */
const selectAllBox = (html: string) => /<input type="checkbox"[^>]*>(?=Every file it lists)/.exec(html)?.[0] ?? '';

describe('a folder picker\'s selector, in its panel', () => {
  it('reads a picker that does not say as one that takes every file, as a run does', () => {
    // The bug: written by ✨, by hand or over MCP, a picker without
    // select_all_files showed the box unticked and offered a selector to
    // write and generate -- and every run still emitted the whole folder.
    const { select_all_files: _, ...unsaid } = { ...builder.create('Folder', 'directory'), selector_code: 'function run(i) { return i; }' };
    const widget = unsaid as GuiWidget;
    expect(builder.selectsAll(widget)).toBe(true);
    expect(selectAllBox(panel(widget))).toContain('checked');
    expect(builder.generation!.available!(widget)).toBe(false);
  });

  it('offers the selector once the box is unticked, and the run then uses it', () => {
    const widget = { ...builder.create('Folder', 'directory'), select_all_files: false };
    expect(builder.selectsAll(widget)).toBe(false);
    expect(selectAllBox(panel(widget))).toContain('type="checkbox"');
    expect(selectAllBox(panel(widget))).not.toContain('checked');
    expect(builder.generation!.available!(widget)).toBe(true);
  });

  it('is the four steps an input node\'s folder is: the listing as the example, and code with ✨ and Try it before there is any', () => {
    const widget = { ...builder.create('Folder', 'directory'), value: 'data', select_all_files: false };
    const html = panel(widget);
    for (const step of ['What comes in', 'What comes out', 'Which files to keep?', 'Code']) expect(html, step).toContain(`aria-label="${step}"`);
    expect(html).toContain('⟳ List them');
    expect(html).toContain('✨ Generate');
    const tryButton = /<button[^>]*>▶ Try it<\/button>/.exec(html)?.[0] ?? '';
    expect(tryButton).not.toBe('');
    expect(tryButton).not.toContain('disabled');
  });
});
