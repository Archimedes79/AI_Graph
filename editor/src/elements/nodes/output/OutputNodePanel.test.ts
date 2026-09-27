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
    onGenerate: async () => false,
  }));
}

describe('an output node\'s panel', () => {
  it('is the run\'s result under the node\'s own name: no window to open, and no second name to give it', () => {
    const node = { ...NODE_KINDS.output.create('totals'), label: 'Totals' };
    const html = panel(node);
    expect(html).toMatch(/<select[^>]*aria-label="Where the result goes"[^>]*><option value="none"[^>]*>Into the run&#x27;s result only<\/option><option value="file">[^<]*<\/option><option value="directory">[^<]*<\/option><\/select>/);
    expect(html).not.toMatch(/window|Name of the result/i);
    expect(html).toContain('The run&#x27;s result calls it what this node is called: “Totals”.');
    // A node without a label is called by its id there, as the run keys it.
    expect(panel({ ...node, label: '' })).toContain('what this node is called: “totals”.');
    expect(baseNodeConfig()).not.toHaveProperty('output_label');
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
