import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InputPickerWidgetPanel from './InputPickerWidgetPanel';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { widgetFields } from '@/authoring/generation';
import type { GuiWidget } from '@/graph';

const builder = WIDGET_BUILDERS.input_picker;

function panel(widget: GuiWidget): string {
  return renderToStaticMarkup(createElement(InputPickerWidgetPanel, {
    builder, widget, onUpdate: () => {}, generation: builder.generation, fields: widgetFields(widget, () => {}),
    generating: false, onGenerate: () => {}, canGenerate: true, expanded: true, onToggleExpand: () => {},
  }));
}

/** The "Select all files" box, as drawn. */
const selectAllBox = (html: string) => /<input type="checkbox"[^>]*>(?=Select all files)/.exec(html)?.[0] ?? '';

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
});
