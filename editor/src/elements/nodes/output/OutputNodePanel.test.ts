import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { nodeFields } from '@/authoring/generation';
import OutputNodePanel from './OutputNodePanel';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so the graph the panel asks about is
// answered here. (Vitest lifts both of these above the imports.)
const open = vi.hoisted(() => ({ rfNodes: [] as { id: string; data: { graphNode: GraphNode } }[] }));
vi.mock('@/store/graphStore', async (actual) => ({
  ...await actual<object>(),
  useGraphStore: (select: (state: typeof open) => unknown) => select(open),
}));

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
  });

  it('names the key its value really has when another output node has its name already', () => {
    // Two output nodes renamed to one label: the run keeps the second under
    // "Totals (avg)" (`resultKeys`), and its dialog said the result calls it "Totals".
    const first = { ...NODE_KINDS.output.create('sum'), label: 'Totals' };
    const second = { ...NODE_KINDS.output.create('avg'), label: 'Totals' };
    open.rfNodes = [first, second].map((graphNode) => ({ id: graphNode.id, data: { graphNode } }));
    try {
      const html = panel(second);
      expect(html).toContain('“Totals” is another output node&#x27;s already, so the run&#x27;s result calls this one “Totals (avg)”.');
      expect(html).not.toContain('what this node is called');
      // The first keeps its name, and the second as the dialog has it -- renamed -- is its own.
      expect(panel(first)).toContain('what this node is called: “Totals”.');
      expect(panel({ ...second, label: 'Averages' })).toContain('what this node is called: “Averages”.');
    } finally {
      open.rfNodes = [];
    }
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
