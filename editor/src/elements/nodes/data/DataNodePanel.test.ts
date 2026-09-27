import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import DataNodePanel, { holdDropped } from './DataNodePanel';

/** A data node's dialog, drawn as the node dialog hands it: the node, its setters, and what only the dialog has. */
function panel(node: GraphNode): string {
  return renderToStaticMarkup(createElement(DataNodePanel, {
    builder: NODE_BUILDERS.data, node, setConfig: () => {}, updateNode: () => {}, setDescription: () => {},
    generating: false, onGenerate: async () => false,
    shell: { graph: () => ({ metadata: {} as never, nodes: [node], edges: [] }), preview: async () => [], graphFile: async () => undefined, flush: () => {} },
  }));
}

describe('a data node\'s dialog', () => {
  it('is its text, what it holds -- its kind and the value -- and ✨ Data, which writes the value: no definitions, no ▶ Try', () => {
    const node = NODE_KINDS.data.create('memory');
    node.config.data_format = 'structure';
    node.config.data_value = { count: 2 };
    const html = panel(node);
    const at = ['aria-label="What it should do"', 'aria-label="Kind"', 'aria-label="What it holds"', '>✨ Data</button>', 'data.json ↗', 'history.md ↗']
      .map((mark) => html.indexOf(mark));
    expect(at.every((index) => index >= 0), String(at)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(html).toMatch(/<textarea[^>]*aria-label="What it holds"[^>]*>\{\n {2}&quot;count&quot;: 2\n\}<\/textarea>/);
    for (const gone of ['✨ Input', '✨ Output', 'input.js', 'output.js', '▶ Try', 'From the graph']) expect(html, gone).not.toContain(gone);
    // A text it holds is kept in data.txt.
    expect(panel(NODE_KINDS.data.create('note'))).toContain('data.txt ↗');
  });

  it('holds what a file dropped on it says -- on its box, or on the node on the canvas', () => {
    const node = NODE_KINDS.data.create('memory');
    expect(panel(node)).toContain('or drop a file here');
    const builder = NODE_BUILDERS.data;
    expect(builder.dropPort(node)).toBe('text');
    expect(builder.withDropped(node, { count: 3 }).config.data_value).toEqual({ count: 3 });
  });

  it('says why a file dropped on its box could not be read, and holds what it held', async () => {
    const set: unknown[] = [];
    let said = 'nothing yet';
    const unreadable = { name: 'locked.json', size: 3, text: () => Promise.reject(new Error('The file is locked by another program.')) };
    await holdDropped(unreadable, (key, value) => set.push([key, value]), (failure) => { said = failure; });
    expect(set).toEqual([]);
    expect(said).toBe('“locked.json” could not be read -- The file is locked by another program.');
    // The next one that is read says nothing more.
    await holdDropped({ name: 'state.json', size: 12, text: async () => '{"count": 3}' }, (key, value) => set.push([key, value]), (failure) => { said = failure; });
    expect(set).toEqual([['data_value', { count: 3 }]]);
    expect(said).toBe('');
  });
});
