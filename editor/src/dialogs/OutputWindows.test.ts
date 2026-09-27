import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OutputWindows from './OutputWindows';
import RequirementsDialog from './RequirementsDialog';

// A run opened one window. (Vitest lifts both of these above the imports.)
const store = vi.hoisted(() => ({
  textOutputWindows: [{ nodeId: 'out', label: 'Summary', content: 'the words' }],
  closeTextOutputWindow: (_nodeId: string) => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: (select: (state: typeof store) => unknown) => select(store),
}));

const count = (html: string, text: string) => html.split(text).length - 1;

/**
 * The windows a run opens are drawn by one component, mounted once per page.
 * Every RequirementsDialog drew them too, and the Preview tab has two of those
 * -- the toolbar's and its own -- so each window was there twice, one on top
 * of the other.
 */
describe('the windows a run opens', () => {
  it('are drawn once, by OutputWindows', () => {
    const html = renderToStaticMarkup(createElement(OutputWindows));
    expect(count(html, 'the words')).toBe(1);
    expect(html).toContain('Summary');
  });

  it('are not drawn again by a RequirementsDialog with nothing to ask', () => {
    const html = renderToStaticMarkup(createElement(RequirementsDialog, {
      requirements: null, onSubmit: () => {}, onCancel: () => {},
    }));
    expect(html).toBe('');
  });
});
