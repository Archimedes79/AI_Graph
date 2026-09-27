import { describe, it, expect } from 'vitest';
import type { WidgetKind } from '@/graph';
import { WIDGET_BUILDERS } from './registry';

/** What every block holds: who it is, and how it is drawn. */
const COMMON = ['id', 'kind', 'label', 'mode', 'w', 'h', 'tone'];

/** What each kind keeps of its own, and reads. */
const OWN: Record<WidgetKind, string[]> = {
  text: ['value'],
  divider: [],
  spacer: [],
  input_picker: ['value', 'extensions', 'recursive'],
  text_io: ['value'],
  plot_window: [],
  image_view: [],
  table: [],
  select: ['options'],
  slider: ['min', 'max', 'step'],
  button: [],
  chat: [],
};

describe('a new block, as the palette puts it on a page', () => {
  it('holds only its own kind\'s settings', () => {
    // The bug: every kind's settings were spread onto every block, so a divider
    // or a chart was saved with a folder's file types, an options list and an
    // example file.
    for (const [kind, builder] of Object.entries(WIDGET_BUILDERS) as [WidgetKind, (typeof WIDGET_BUILDERS)[WidgetKind]][]) {
      const extra = Object.keys(builder.create('Block')).filter((key) => !COMMON.includes(key) && !OWN[kind].includes(key));
      expect(extra, kind).toEqual([]);
    }
  });

  it('starts a folder picker as a folder and its file types, and a table with nothing but its place', () => {
    expect(WIDGET_BUILDERS.input_picker.create('Folder', 'directory')).toMatchObject({ value: '', extensions: '', recursive: false });
    expect(WIDGET_BUILDERS.input_picker.create('Folder', 'directory')).not.toHaveProperty('selector_code');
    expect(WIDGET_BUILDERS.table.create('Rows')).not.toHaveProperty('code');
  });

  it('carries no mode for a kind that has none', () => {
    expect(WIDGET_BUILDERS.button.create('Go')).not.toHaveProperty('mode');
    expect(WIDGET_BUILDERS.text_io.create('Box')).toMatchObject({ mode: 'both' });
  });
});
