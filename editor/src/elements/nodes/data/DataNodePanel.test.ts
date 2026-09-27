import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { nodeFields } from '@/authoring/generation';
import DataNodePanel, { holdDropped } from './DataNodePanel';

/** A data node's dialog, drawn as the node dialog hands it: nothing but the node and its setters. */
function panel(node: GraphNode): string {
  return renderToStaticMarkup(createElement(DataNodePanel, {
    builder: NODE_BUILDERS.data, node, setConfig: () => {}, updateNode: () => {},
    fields: nodeFields(node, () => {}, () => {}), generating: false, onGenerate: async () => false,
  }));
}

describe('a data node\'s dialog', () => {
  it('is its value, in one place: the kind and what it holds, with no steps and no ✨', () => {
    const node = NODE_KINDS.data.create('memory');
    node.config.data_format = 'structure';
    node.config.data_value = { count: 2 };
    const html = panel(node);
    expect(html).toContain('aria-label="Kind"');
    expect(html).toMatch(/<textarea[^>]*aria-label="What it holds"[^>]*>\{\n {2}&quot;count&quot;: 2\n\}<\/textarea>/);
    // It used to be drawn only inside the four steps: without them it drew nothing.
    for (const gone of ['What should it hold?', 'Its format', 'What comes in', '✨', 'From the graph', 'From a file']) {
      expect(html, gone).not.toContain(gone);
    }
  });

  it('is not written and not generated: the node dialog lays out no steps for it, and a sweep passes it by', () => {
    const builder = NODE_BUILDERS.data;
    expect(builder.stepped).toBe(false);
    expect(builder.generation).toBeUndefined();
    expect(builder.exampleInput(NODE_KINDS.data.create('memory'))).toBeUndefined();
  });

  it('holds what a file dropped on it says -- on its box, or on the node on the canvas', () => {
    const node = NODE_KINDS.data.create('memory');
    expect(panel(node)).toContain('or drop a file here');
    const builder = NODE_BUILDERS.data;
    expect(builder.dropPort(node)).toBe('input');
    expect(builder.withExampleValue(node, 'input', { count: 3 }).config.data_value).toEqual({ count: 3 });
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
