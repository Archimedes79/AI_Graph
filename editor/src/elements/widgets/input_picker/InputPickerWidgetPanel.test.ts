import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InputPickerWidgetPanel from './InputPickerWidgetPanel';
import { WIDGET_BUILDERS } from '@/elements/registry';
import type { GuiWidget } from '@/graph';

const builder = WIDGET_BUILDERS.input_picker;

function panel(widget: GuiWidget): string {
  return renderToStaticMarkup(createElement(InputPickerWidgetPanel, { builder, widget, onUpdate: () => {} }));
}

/** A folder picked on a page: its file types and its subfolders, then the list. */
describe('a folder picker, in its panel', () => {
  it('is the folder, its file types and its subfolders, and a way to see the list -- no code, no ✨', () => {
    const html = panel({ ...builder.create('Folder', 'directory'), value: 'data' });
    expect(html).toContain('aria-label="Folder"');
    expect(html).toContain('aria-label="File types"');
    expect(html).toContain('Look into subfolders too');
    const list = /<button[^>]*>Show the files it lists<\/button>/.exec(html)?.[0] ?? '';
    expect(list).not.toBe('');
    expect(list).not.toContain('disabled');
    expect(html).not.toContain('✨');
    expect(html).not.toContain('▶ Try');
  });

  it('says in one line that keeping some of the files is a code node after it', () => {
    expect(panel(builder.create('Folder', 'directory'))).toContain('To use only some of them, wire a code node after it');
  });

  it('has nothing to list before a folder is chosen, and no listing at all for one file', () => {
    expect(/<button[^>]*disabled[^>]*>Show the files it lists/.test(panel(builder.create('Folder', 'directory')))).toBe(true);
    expect(panel(builder.create('File', 'file'))).not.toContain('Show the files it lists');
  });
});
