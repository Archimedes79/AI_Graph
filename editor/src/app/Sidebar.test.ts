import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar from './Sidebar';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so the one question the palette asks is
// answered here: how deep into the document the canvas is. (Vitest lifts both
// of these above the imports.)
const level = vi.hoisted(() => ({ subgraphStack: [] as unknown[] }));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: (select: (state: typeof level) => unknown) => select(level),
}));

/** The palette's disabled entries, by what they say. */
const disabled = (): string[] => {
  const html = renderToStaticMarkup(createElement(Sidebar, { onAddNode: () => {} }));
  return [...html.matchAll(/<button[^>]*disabled=""[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
};

describe('the node palette', () => {
  it('offers every node in the graph at the top', () => {
    level.subgraphStack = [];
    expect(disabled()).toEqual([]);
  });

  it('does not offer a page inside a node\'s graph, where check rejects one, and says why', () => {
    // The rest of B24: the GUI editor no longer adds a page in there, but the
    // palette still did.
    level.subgraphStack = [{ nodeId: 'part' }];
    const off = disabled();
    expect(off).toHaveLength(1);
    expect(off[0]).toContain('A page belongs to the graph at the top.');
    expect(off[0]).not.toContain('draggable="true"');
  });
});
