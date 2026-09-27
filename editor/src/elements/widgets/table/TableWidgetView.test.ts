import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TableWidgetView from './TableWidgetView';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { SUNKEN } from '@/ui/theme';

const widget = WIDGET_BUILDERS.table.create('Rows');
const shown = (incoming: unknown, value: unknown = undefined) => renderToStaticMarkup(createElement(TableWidgetView, {
  widget, value, incoming, onChange: () => {},
}));

describe('a table on the page', () => {
  it('draws its header in the page\'s scheme, not a fixed dark band', () => {
    // The bug: the header was rgba(15,17,23,0.95) on every scheme, a dark band
    // across a light page. It follows the scheme's own colour now, opaque,
    // because rows scroll under it.
    const html = shown([{ city: 'Oslo', people: 700000 }]);
    expect(html).toContain('<th');
    expect(html).not.toContain('rgba(15,17,23');
    expect(html).toContain(`background:${SUNKEN}`);
  });

  it('shows the rows that arrive: objects, whose keys are the columns, or lists under a header row', () => {
    const objects = shown([{ city: 'Oslo', people: 700000 }, { city: 'Bergen', people: 290000 }]);
    expect(objects.match(/<th[ >]/g)).toHaveLength(2);
    expect(objects).toContain('Bergen');
    const lists = shown([['city', 'people'], ['Oslo', 700000]]);
    expect(lists).toContain('>city</th>');
    expect(lists).toContain('>Oslo</td>');
  });

  it('shows what arrived as text when it is not rows, and waits quietly for nothing', () => {
    expect(shown('just a sentence')).toContain('just a sentence');
    expect(shown(undefined)).toContain('No data yet');
  });
});
