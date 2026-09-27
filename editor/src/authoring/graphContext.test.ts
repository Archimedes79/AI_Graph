import { describe, it, expect } from 'vitest';
import type { GraphNode, GuiWidget, Wire } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { blockSize } from '@/document/layout';
import { scheme } from '@/ui/scheme';
import { CONTEXT_LIMIT, graphContext } from './graphContext';

/** {Context}: the graph around a node, as every ✨ of it is told. */

const chart = { id: 'sizes', kind: 'plot_window', label: 'Sizes' } as GuiWidget;

function graph(): { nodes: GraphNode[]; edges: Wire[]; metadata: never } {
  const page = { ...NODE_KINDS.gui.create('page'), config: { ...NODE_KINDS.gui.create('page').config, gui_widgets: [chart] } };
  const count = { ...NODE_KINDS.code.create('count'), label: 'Count', description: 'Counts the words of each file.\nIn detail: split on spaces.' };
  const read = { ...NODE_KINDS.input.create('read'), label: 'Read' };
  return {
    // Listed out of order: they are said in the order they run.
    nodes: [count, page, read],
    edges: [
      { source: 'read', sourceHandle: read.outputs[0].id, target: 'count', targetHandle: 'input' },
      { source: 'count', sourceHandle: 'output', target: 'page', targetHandle: 'sizes_in' },
    ],
    metadata: { name: 'Word counts', description: 'How long each story is.', gui_scheme: 'night' } as never,
  };
}

describe('{Context}', () => {
  it('says the graph, every node in the order it runs with the first line of its text, this one marked, and the wires', () => {
    const said = graphContext('count', graph());
    expect(said).toMatch(/^Graph: Word counts\nHow long each story is\.\n\nIts nodes, in the order they run:\n- read \(input\) "Read"\n- count \(code\) "Count": Counts the words of each file\. {3}<- this node\n/);
    expect(said).not.toContain('In detail');
    expect(said).toContain('Its wires:\n- read.');
    expect(said).toContain('- count.output -> page.sizes_in');
  });

  it('says the page: its colour scheme, and each block with its size, as the editor draws it', () => {
    const colours = scheme('night');
    const { width, height } = blockSize(chart);
    const said = graphContext('count', graph());
    expect(said).toContain(`Its page (page), on the ${colours.label} scheme -- background ${colours.sunken}, text ${colours.text}, accent ${colours.accent}:`);
    expect(said).toContain(`- sizes: a plot_window block "Sizes", about ${width} x ${height} px`);
  });

  it('is cut to its budget, so a large graph leaves a small model room to answer', () => {
    const many = graph();
    many.nodes = [...many.nodes, ...Array.from({ length: 200 }, (_, n) => ({ ...NODE_KINDS.code.create(`n${n}`), description: 'x'.repeat(40) }))];
    const said = graphContext('count', many);
    expect(said.length).toBeLessThan(CONTEXT_LIMIT + 60);
    expect(said.endsWith('… (the rest of the graph is left out)')).toBe(true);
  });

  it('still says every node where the graph has no order -- a circle a run refuses', () => {
    const circle = graph();
    circle.edges = [...circle.edges, { source: 'count', sourceHandle: 'output', target: 'read', targetHandle: 'x' }];
    circle.edges.push({ source: 'read', sourceHandle: 'files', target: 'count', targetHandle: 'input' });
    const said = graphContext('count', circle);
    for (const id of ['count', 'page', 'read']) expect(said).toContain(`- ${id} (`);
  });
});
