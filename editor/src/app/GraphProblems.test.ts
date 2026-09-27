import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Graph } from '@/graph';
import GraphProblems from './GraphProblems';

const page = (id: string, block: string) => ({
  id, node_type: 'gui', label: 'Page', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [],
  config: { gui_widgets: [{ id: block, kind: 'text', mode: 'heading', label: '', tone: 'plain', value: block, w: 16, h: 1 }] },
});
const said = (graph: unknown) => renderToStaticMarkup(createElement(GraphProblems, { graph: graph as Graph }));

describe('a graph about to be loaded from outside -- designed by ✨ AI Graph, pasted as JSON', () => {
  it('has what `check` finds in it said before Load: a second page, which nothing would show', () => {
    // It was loaded without a word, and the second page's blocks could then be
    // neither seen nor changed on the Page tab.
    const html = said({ metadata: { name: 'Two' }, nodes: [page('main', 'answer'), page('extra', 'notes')], edges: [] });
    expect(html).toContain('This graph has a problem. Load takes it as it is.');
    expect(html).toContain('A graph has one page, and these are 2: only the blocks of &quot;main&quot; are shown.');
  });

  it('says so when it cannot be read as a graph at all', () => {
    expect(said({ nodes: [{ label: 'No id' }], edges: [] })).toContain('Not a node: every node needs an id and a node_type.');
  });

  it('says nothing of a sound one', () => {
    expect(said({ metadata: { name: 'One' }, nodes: [page('main', 'answer')], edges: [] })).toBe('');
  });
});
