import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NODE_KINDS } from '@/document/nodeKinds';
import ChangeBar from './ChangeBar';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so which node's panel is open is
// answered here. (Vitest lifts both of these above the imports.)
const open = vi.hoisted(() => ({
  rfNodes: [] as unknown[], editingNodeId: null as string | null, past: [],
  clearSelection: () => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: Object.assign((select: (state: typeof open) => unknown) => select(open), { getState: () => open }),
}));

open.rfNodes = [
  { id: 'count', data: { graphNode: { ...NODE_KINDS.code.create('count'), label: 'Count words' } } },
  { id: 'source', data: { graphNode: { ...NODE_KINDS.input.create('source'), label: 'The text' } } },
  { id: 'capitals', data: { graphNode: { ...NODE_KINDS.data.create('capitals'), label: 'Capitals' } } },
];

/** The bar as drawn with *openId*'s panel open, and its "on:" button. */
function bar(openId: string | null): { html: string; on: string; change: string } {
  open.editingNodeId = openId;
  const html = renderToStaticMarkup(createElement(ChangeBar));
  return {
    html,
    on: html.match(/<button[^>]*>on: [^<]*<\/button>/)?.[0] ?? '',
    change: html.match(/<button[^>]*>Change<\/button>/)?.[0] ?? '',
  };
}

describe('the bar under the canvas', () => {
  it('is on the whole graph while no node is selected -- its "on:" has nothing to clear then', () => {
    const { html, on } = bar(null);
    expect(on).toContain('>on: the whole graph<');
    expect(on).toContain('disabled=""');
    expect(html).toContain('placeholder="Say what to change…"');
  });

  it('is on the node whose panel is open, by its heading; its "on:" goes back to the whole graph', () => {
    const { on } = bar('count');
    expect(on).toContain('>on: Count words<');
    expect(on).not.toContain('disabled');
    // A quarter of the row at most, so the field keeps room beside a panel at 1024; whole in its title.
    expect(on).toContain('max-w-[25%]');
    expect(on).toContain('title="On Count words. Click to say it about the whole graph instead"');
  });

  it('says where a change goes: a body to its node\'s panel, anything else to ✨ AI Graph, shown before it is applied', () => {
    expect(bar('count').change).toContain('title="Change Count words as said: its panel writes it, and tries it"');
    // A data node has no ▶ Try.
    expect(bar('capitals').change).toContain('title="Change Capitals as said: its panel writes it"');
    expect(bar('source').change).toMatch(/title="Ask ✨ AI Graph to change the graph as said: you see what it changes before it is applied"/);
    expect(bar(null).change).toMatch(/title="Ask ✨ AI Graph/);
    // Nothing said yet, nothing to send.
    expect(bar(null).change).toContain('disabled=""');
  });
});
