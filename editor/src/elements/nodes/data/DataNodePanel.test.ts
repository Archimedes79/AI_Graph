import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { nodeFields } from '@/authoring/generation';
import DataNodePanel from './DataNodePanel';

/** A data node's dialog, drawn as the node dialog hands it: nothing but the node and its setters. */
function panel(node: GraphNode): string {
  return renderToStaticMarkup(createElement(DataNodePanel, {
    builder: NODE_BUILDERS.data, node, setConfig: () => {}, updateNode: () => {}, setInvalid: () => {},
    fields: nodeFields(node, () => {}, () => {}), generating: false, onGenerate: () => {},
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
});
