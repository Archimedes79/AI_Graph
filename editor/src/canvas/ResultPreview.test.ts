import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from 'reactflow';
import ResultPreview from './ResultPreview';
import GraphNodeView from './GraphNodeView';
import { NODE_KINDS } from '@/document/nodeKinds';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so the last run is answered here. (Vitest
// lifts both of these above the imports.)
const open = vi.hoisted(() => ({
  executionResult: null as unknown,
  rfEdges: [], setEditingNode: () => {}, deleteNode: () => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: (select: (state: typeof open) => unknown) => select(open),
}));

const drawn = (preview: Parameters<typeof ResultPreview>[0]['preview']) => renderToStaticMarkup(createElement(ResultPreview, { preview }));

describe('a value under a port on the canvas', () => {
  it('is a line, a count with its first row, a sketch or a thumbnail -- each a line or a small picture high', () => {
    expect(drawn({ kind: 'line', text: 'Three stories' })).toContain('Three stories');
    const rows = drawn({ kind: 'rows', count: 214, noun: 'rows', first: 'name: Oslo, people: 700' });
    expect(rows).toContain('214 rows');
    expect(rows).toContain('name: Oslo, people: 700');
    expect(drawn({ kind: 'rows', count: 1, noun: 'items', first: 'a.txt' })).toContain('1 item<');
    expect(drawn({ kind: 'sketch', values: [3, 1, 2], line: false }).match(/<rect/g)).toHaveLength(3);
    expect(drawn({ kind: 'sketch', values: [3, 1, 2, 4], line: true })).toContain('<polyline');
    const image = drawn({ kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', count: 3 });
    expect(image).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(image).toContain('+2');
  });
});

describe('a node on the canvas, after a run', () => {
  const node = (result: unknown) => {
    open.executionResult = { status: 'success', outputs: {}, node_results: [result] };
    const graphNode = { ...NODE_KINDS.code.create('count'), label: 'Count' };
    return renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(GraphNodeView, {
      id: 'count', data: { graphNode }, selected: false, type: 'graphNode', zIndex: 0, isConnectable: true,
      xPos: 0, yPos: 0, dragging: false,
    })));
  };

  it('shows what it made under the port it came out of, not the run\'s JSON', () => {
    const rows = Array.from({ length: 214 }, (_, i) => ({ name: `Town ${i}` }));
    const html = node({ node_id: 'count', status: 'success', inputs: {}, outputs: { output: rows } });
    expect(html).toContain('214 rows');
    expect(html).toContain('name: Town 0');
    expect(html).not.toContain('{&quot;output&quot;');
  });

  it('shows what it made in an earlier round, faded, when it stood still in this one', () => {
    // As the executor hands on a node whose ◆ stayed shut and whose latch kept
    // its outputs: skipped, held, the outputs there. Asked by status alone, the
    // canvas drew the held glyph and no value.
    const html = node({
      node_id: 'count', status: 'skipped', held: true, inputs: {},
      outputs: { output: 'Once upon a time there was a lighthouse keeper.' },
      error: null, messages: ['Nothing opened its ◆ this round. What it produced last stands.'],
    });
    expect(html).toContain('‖');
    expect(html).toContain('Once upon a time there was a lighthouse keeper.');
    expect(html).toContain('opacity:0.6');
  });

  it('shows what a run that lost items made in amber, as the results panel says it -- not in a success\'s green', () => {
    const drawnAs = (status: string) => node({ node_id: 'count', status, inputs: {}, outputs: { output: 'Two of three stories' }, error: null });
    expect(drawnAs('partial')).toContain('color:#fcd34d');
    expect(drawnAs('partial')).not.toContain('color:#86efac');
    expect(drawnAs('success')).toContain('color:#86efac');
  });

  it('shows why it failed, on one line', () => {
    const html = node({ node_id: 'count', status: 'error', inputs: {}, outputs: {}, error: 'No such file: data/x.csv\nat read' });
    expect(html).toMatch(/title="No such file: data\/x.csv\nat read"[^>]*>No such file: data\/x.csv</);
  });
});
