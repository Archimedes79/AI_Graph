import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TableWidgetView from './TableWidgetView';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { SUNKEN } from '@/ui/theme';

describe('a table on the page', () => {
  it('draws its header in the page\'s scheme, not a fixed dark band', () => {
    // The bug: the header was rgba(15,17,23,0.95) on every scheme, a dark band
    // across a light page. It follows the scheme's own colour now, opaque,
    // because rows scroll under it.
    const widget = WIDGET_BUILDERS.table.create('Rows');
    const html = renderToStaticMarkup(createElement(TableWidgetView, {
      widget, value: undefined, incoming: [{ city: 'Oslo', people: 700000 }], onChange: () => {},
    }));
    expect(html).toContain('<th');
    expect(html).not.toContain('rgba(15,17,23');
    expect(html).toContain(`background:${SUNKEN}`);
  });
});
