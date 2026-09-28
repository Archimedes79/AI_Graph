import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ImageViewWidgetView from './ImageViewWidgetView';
import { WIDGET_BUILDERS } from '@/elements/registry';

const widget = WIDGET_BUILDERS.image_view.create('cover', 'Cover');
const shown = (incoming: unknown) => renderToStaticMarkup(createElement(ImageViewWidgetView, {
  widget, value: undefined, incoming, onChange: () => {},
}));

describe('an image on the page', () => {
  it('says a value arrived that is not a path, rather than that nothing arrived', () => {
    // The bug: a record such as {cover: "a.png"} was dropped, and the block
    // said nothing had arrived.
    const html = shown({ cover: 'a.png' });
    expect(html).not.toContain('No image yet');
    expect(html).toContain('shows an image file path or URL');
    expect(html).toContain('{&quot;cover&quot;:&quot;a.png&quot;}');
    expect(html).toContain('A code node wired in before it can pick the path out of it.');
  });

  it('draws what arrives as a data URL or an http URL, a list as a contact sheet', () => {
    const html = shown(['data:image/png;base64,AAAA', 'https://example.org/b.png']);
    expect(html.match(/<img/g)).toHaveLength(2);
    expect(html).toContain('2 images');
  });

  it('says so for such an item in a list, and draws the rest', () => {
    const html = shown(['data:image/png;base64,AAAA', { cover: 'b.png' }]);
    expect(html).toContain('<img');
    expect(html).toContain('shows an image file path or URL');
  });

  it('still waits quietly when nothing has arrived, in the words of whoever uses the tool', () => {
    // It told them to "wire a file path into Cover and run the graph":
    // the builder's words, on the delivered page.
    for (const nothing of [undefined, null, '']) {
      expect(shown(nothing)).toContain('>No image yet<');
      expect(shown(nothing)).not.toMatch(/wire|run the graph/);
    }
  });
});
