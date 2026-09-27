import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TopGraphOnly from './TopGraphOnly';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so the one question it asks is answered
// here instead: how deep into the document the canvas is. (Vitest lifts both
// of these above the imports.)
const level = vi.hoisted(() => ({ subgraphStack: [] as unknown[], isExecuting: false, closeSubgraphsTo: () => {} }));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: (select: (state: typeof level) => unknown) => select(level),
}));

const shown = () => renderToStaticMarkup(createElement(TopGraphOnly, null, createElement('p', null, 'the page designer')));

describe('the page views, at each level of the document', () => {
  it('are themselves in the graph at the top', () => {
    level.subgraphStack = [];
    expect(shown()).toContain('the page designer');
  });

  it('are not there inside a node\'s graph, where they would build a page nobody sees', () => {
    // The bug: the GUI editor inside a subgraph added a gui node in there on
    // the first block, which `check` rejects, and wrote the colour scheme into
    // the inner graph.
    level.subgraphStack = [{ nodeId: 'part' }];
    const html = shown();
    expect(html).not.toContain('the page designer');
    expect(html).toContain('The page belongs to the graph at the top.');
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it('say why the way up waits while a run is in flight, instead of a button that does nothing', () => {
    // No level closes during a run (`closeSubgraph`), so the button would have
    // been pressed to no effect and no word.
    level.subgraphStack = [{ nodeId: 'part' }];
    level.isExecuting = true;
    try {
      const html = shown();
      expect(html).toMatch(/<button[^>]*disabled/);
      expect(html).toContain('The way up opens when it is over.');
    } finally {
      level.isExecuting = false;
    }
  });
});
