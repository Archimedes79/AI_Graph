import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NODE_KINDS } from '@/document/nodeKinds';
import type { GraphNode } from '@/graph';
import { GuiSurfacePage } from './GuiPage';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so what the page asks is answered here.
// (Vitest lifts both of these above the imports.)
const open = vi.hoisted(() => ({
  rfNodes: [] as { data: { graphNode: unknown } }[],
  metadata: { name: 'Word counter', description: 'Counts the words.', gui_scheme: 'night' },
  executionResult: null as unknown,
  isExecuting: false,
  exportGraph: () => ({}), updateNode: () => {}, runGraph: async () => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: Object.assign((select: (state: typeof open) => unknown) => select(open), { getState: () => open }),
}));

const output = { ...NODE_KINDS.output.create('count'), label: 'Words' } as GraphNode;
const ran = {
  status: 'success',
  node_results: [{ node_id: 'count', status: 'success', inputs: { value: 'forty-two words' }, outputs: { value: 'forty-two words' } }],
  outputs: { Words: { value: 'forty-two words' } },
};

const drawn = (nodes: GraphNode[]) => {
  open.rfNodes = nodes.map((graphNode) => ({ data: { graphNode } }));
  open.executionResult = ran;
  return renderToStaticMarkup(createElement(GuiSurfacePage));
};

describe('a tool whose page has no blocks, after ▶ Run', () => {
  it('shows what the tool does and what its run handed back', () => {
    const html = drawn([output]);
    expect(html).toContain('Counts the words.');
    expect(html).toContain('forty-two words');
  });

  it('shows the same with a page node whose last block is gone: a page is its blocks', () => {
    // The page node stayed after its last block was removed, and the tool
    // drew an empty page where the run's result belongs.
    const html = drawn([NODE_KINDS.gui.create('page'), output]);
    expect(html).toContain('Counts the words.');
    expect(html).toContain('forty-two words');
  });
});
