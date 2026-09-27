import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import { NODE_BUILDERS } from '@/elements/registry';
import { nodeFields } from '@/authoring/generation';
import OutputNodePanel from './OutputNodePanel';

function panel(node: GraphNode): string {
  return renderToStaticMarkup(createElement(OutputNodePanel, {
    builder: NODE_BUILDERS.output, node, setConfig: () => {}, updateNode: () => {},
    fields: nodeFields(node, () => {}, () => {}), generating: false,
    onGenerate: () => {},
  }));
}

/** An output node as a graph file that names nothing loads: its id keys the result. */
function unnamed(): GraphNode {
  const node = NODE_KINDS.output.create('totals');
  return { ...node, config: baseNodeConfig() };
}

describe('an output node\'s panel', () => {
  it('says that an empty name is the node\'s id, rather than show a name that looks lost (B57)', () => {
    const html = panel(unnamed());
    expect(html).toContain('placeholder="Empty: the node’s id, “totals”, names the result" aria-label="Name of the result" value=""');
  });

  it('asks what the result is, which the node feeding it is told, in its own words', () => {
    const node = { ...NODE_KINDS.output.create('o'), description: 'one row per country' };
    expect(panel(node)).toMatch(/<textarea[^>]*aria-label="What the result is"[^>]*>one row per country<\/textarea>/);
    // One box for it: the dialog draws no second "Description" above the panel.
    expect(NODE_BUILDERS.output.ownsDescription).toBe(true);
  });

  it('asks for a folder, and offers to browse for it, when each value goes into a file of its own', () => {
    const node = NODE_KINDS.output.create('o');
    node.config.write_mode = 'directory';
    const html = panel(node);
    expect(html).toContain('aria-label="Folder"');
    expect(html).toContain('📂 Browse…');
    expect(html).toContain('Each value that arrives becomes a file of its own in this folder.');
    expect(panel(NODE_KINDS.output.create('o'))).not.toContain('📂 Browse…');
  });
});
