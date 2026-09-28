import { describe, expect, it } from 'vitest';
import type { Graph, GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { changeGoesTo, changeTarget, describeChange, graphChange, graphRequest, targetName } from './graphChange';

const reader: GraphNode = { ...NODE_KINDS.code.create('reader'), label: 'Read file' };
const source: GraphNode = { ...NODE_KINDS.input.create('source'), label: 'CSV' };
const shown: GraphNode = { ...NODE_KINDS.output.create('shown'), label: 'Rows' };
const graph = (nodes: GraphNode[], wires: [string, string][] = []): Graph => ({
  metadata: { name: 'Rows', description: '', gui_scheme: 'night' },
  nodes,
  edges: wires.map(([from, to], index) => ({
    id: `e${index}`, source_node_id: from, source_port_id: 'output', target_node_id: to, target_port_id: 'value',
  })),
});

describe('what the bar under the canvas is on', () => {
  it('is the node whose panel is open -- and with none, or one that is gone, the whole graph', () => {
    expect(changeTarget([reader, source], 'reader')).toBe(reader);
    expect(changeTarget([reader, source], null)).toBeNull();
    expect(changeTarget([source], 'reader')).toBeNull();
    expect(targetName(reader)).toBe('Read file');
    expect(targetName(null)).toBe('the whole graph');
  });

  it('sends what is said on a node whose body ✨ writes to its panel, and the rest to the graph', () => {
    expect(changeGoesTo(reader)).toBe('panel');
    // An input's text, an output's file, a page's blocks: the graph's to change, wires and all.
    expect(changeGoesTo(source)).toBe('graph');
    expect(changeGoesTo(shown)).toBe('graph');
    expect(changeGoesTo(null)).toBe('graph');
  });

  it('asks the graph to change the node it was said on, by its heading and its id', () => {
    expect(graphRequest(null, 'Add a table of the rows.')).toBe('Add a table of the rows.');
    expect(graphRequest(source, 'Read data/other.csv instead.')).toBe('In the node "CSV" (id "source"): Read data/other.csv instead.');
  });
});

describe('what a change of the whole graph changes', () => {
  it('is the nodes it adds, removes and changes, and the wires that come and go', () => {
    const before = graph([source, reader, shown], [['source', 'reader'], ['reader', 'shown']]);
    const after = graph([source, { ...reader, label: 'Read the file' }, { ...NODE_KINDS.output.create('more'), label: 'More' }],
      [['source', 'reader'], ['reader', 'more']]);
    const change = graphChange(before, after);
    expect(change.added.map((node) => node.id)).toEqual(['more']);
    expect(change.removed.map((node) => node.id)).toEqual(['shown']);
    expect(change.changed.map((node) => node.id)).toEqual(['reader']);
    expect(change.wires).toEqual({ added: 1, removed: 1 });
    expect(describeChange(change)).toEqual([
      'Adds More.', 'Removes Rows.', 'Changes Read the file.', 'Wires: 1 added, 1 removed.',
    ]);
  });

  it('does not count a node moved, or one whose defaults the model spelled out or left out, as changed', () => {
    const before = graph([source, reader]);
    const spelledOut = { ...reader, position: { x: 400, y: 90 }, config: { ...reader.config, catch_errors: false } };
    const leftOut = { ...source, config: { value: source.config.value } as GraphNode['config'] };
    const change = graphChange(before, graph([leftOut, spelledOut]));
    expect(change.changed).toEqual([]);
    expect(describeChange(change)).toEqual(['Nothing in the graph changes.']);
  });
});
