import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, Port } from '@/graph';
import { useGraphStore } from './graphStore';
import { portRenames, trackPorts, untracked } from './portRenames';
import { saveDraft } from '@/canvas/nodeDraft';
import { baseNodeConfig } from '@/document/baseNodeConfig';

/**
 * The node dialog, written into the graph: which wire ends up on which port.
 *
 * A port's id is the name a body reads it by -- `inputs.csv`, `{ figure }` --
 * so the ports editor edits exactly that, and a rename must not cut the wire
 * on it: renaming `input` to `csv` would otherwise quietly cut the graph in half.
 *
 * The three edits below are the ones the ports editor makes (`PortsEditor`):
 * a row is edited by spreading it with the change, removed by filtering it
 * out, and a new one is appended. Each test edits a draft that way, writes it
 * the way the dialog does (`saveDraft`, from `nodeDialog`), and looks at the wires.
 */
const edit = (ports: Port[], at: number, patch: Partial<Port>) => ports.map((port, i) => (i === at ? { ...port, ...patch } : port));
const remove = (ports: Port[], at: number) => ports.filter((_, i) => i !== at);
const add = (ports: Port[], id: string): Port[] => [...ports, { id, name: id, kind: 'input', data_type: 'any', multi: false, required: false, description: '' }];

const input = (id: string): Port => ({ id, name: id, kind: 'input', data_type: 'any', multi: false, required: false, description: '' });
const output = (id: string): Port => ({ id, name: id, kind: 'output', data_type: 'any', multi: false, required: false, description: '' });

function node(id: string, inputs: Port[], outputs: Port[] = []): GraphNode {
  return { id, node_type: 'code', label: id, description: '', position: { x: 0, y: 0 }, inputs, outputs, config: baseNodeConfig() };
}

const store = () => useGraphStore.getState();
const stored = (id: string) => store().rfNodes.find((n) => n.id === id)!.data.graphNode as GraphNode;
/** Every wire into *target*, as "source -> port". */
const into = (target: string) => store().rfEdges
  .filter((edge) => edge.target === target)
  .map((edge) => `${edge.source} -> ${edge.targetHandle}`)
  .sort();

/** Open *id* in the dialog, change its ports with *change*, and press Save. */
function saveDialog(id: string, change: (draft: GraphNode) => GraphNode) {
  const draft = change(trackPorts(JSON.parse(JSON.stringify(stored(id)))));
  saveDraft(id, stored(id), draft);
}

const wire = (source: string, target: string, port: string): GraphEdge =>
  ({ id: `${source}-${target}-${port}`, source_node_id: source, source_port_id: 'out', target_node_id: target, target_port_id: port });

function load(nodes: GraphNode[], edges: GraphEdge[]) {
  store().loadGraph({
    metadata: { name: 'T', description: '', gui_scheme: 'night' },
    nodes,
    edges,
  });
}

beforeEach(() => {
  load([
    node('a', [], [output('out')]),
    node('b', [], [output('out')]),
    node('ai', [input('prompt'), input('context')], [output('output')]),
  ], [wire('a', 'ai', 'prompt'), wire('b', 'ai', 'context')]);
});

describe('saving the node dialog: the wires follow the ports, not the rows', () => {
  it('takes a removed port\'s wire away, and leaves the port that slid into its row alone', () => {
    // The bug: removing `prompt` read as "prompt renamed to context", so the
    // wire from a landed on context, which then had two.
    saveDialog('ai', (draft) => ({ ...draft, inputs: remove(draft.inputs, 0) }));
    expect(stored('ai').inputs.map((port) => port.id)).toEqual(['context']);
    expect(into('ai')).toEqual(['b -> context']);
  });

  it('does the same for the last of three, and for a port in the middle', () => {
    load([node('a', [], [output('out')]), node('b', [], [output('out')]), node('c', [], [output('out')]),
      node('code', [input('csv'), input('kind'), input('top')])],
    [wire('a', 'code', 'csv'), wire('b', 'code', 'kind'), wire('c', 'code', 'top')]);
    saveDialog('code', (draft) => ({ ...draft, inputs: remove(draft.inputs, 1) }));
    expect(into('code')).toEqual(['a -> csv', 'c -> top']);
  });

  it('moves the wire of a port that was renamed', () => {
    saveDialog('ai', (draft) => ({ ...draft, inputs: edit(draft.inputs, 0, { id: 'question' }) }));
    expect(into('ai')).toEqual(['a -> question', 'b -> context']);
  });

  it('moves the wire of an output that was renamed, at its source end', () => {
    load([node('code', [], [output('output')]), node('sink', [input('value')])],
      [{ id: 'e1', source_node_id: 'code', source_port_id: 'output', target_node_id: 'sink', target_port_id: 'value' }]);
    saveDialog('code', (draft) => ({ ...draft, outputs: edit(draft.outputs, 0, { id: 'figure' }) }));
    expect(store().rfEdges.map((edge) => `${edge.source}.${edge.sourceHandle} -> ${edge.target}.${edge.targetHandle}`))
      .toEqual(['code.figure -> sink.value']);
  });

  it('tells a removal and a rename apart when both happen before one Save', () => {
    // Remove `prompt`, then rename `context` to `prompt`. By rows this was
    // "context renamed to prompt" with prompt's wire staying put -- the port
    // now called prompt got both wires.
    saveDialog('ai', (draft) => {
      const without = remove(draft.inputs, 0);
      return { ...draft, inputs: edit(without, 0, { id: 'prompt' }) };
    });
    expect(stored('ai').inputs.map((port) => port.id)).toEqual(['prompt']);
    expect(into('ai')).toEqual(['b -> prompt']);
  });

  it('swaps two names, and the wires swap with them', () => {
    saveDialog('ai', (draft) => {
      let inputs = edit(draft.inputs, 0, { id: 'tmp' });
      inputs = edit(inputs, 1, { id: 'prompt' });
      inputs = edit(inputs, 0, { id: 'context' });
      return { ...draft, inputs };
    });
    expect(into('ai')).toEqual(['a -> context', 'b -> prompt']);
  });

  it('gives a new port no wire, and keeps every old one where it was', () => {
    saveDialog('ai', (draft) => ({ ...draft, inputs: add(draft.inputs, 'extra') }));
    expect(into('ai')).toEqual(['a -> prompt', 'b -> context']);
  });

  it('counts a port the element put back under the same name as the same port', () => {
    // "Catch failures" adds `error` as a new object, not through the ports
    // editor: it is the port of its name, and its wires stay.
    load([node('code', [], [output('output'), output('error')]), node('sink', [input('value'), input('why')])],
      [{ id: 'e1', source_node_id: 'code', source_port_id: 'error', target_node_id: 'sink', target_port_id: 'why' }]);
    saveDialog('code', (draft) => ({ ...draft, outputs: [...draft.outputs.filter((port) => port.id !== 'error'), output('error')] }));
    expect(into('sink')).toEqual(['code -> why']);
  });
});

describe('what the dialog keeps on a port to tell them apart', () => {
  it('is never written: the draft reads as the node it came from', () => {
    const plain = node('n', [input('a')], [output('b')]);
    const draft = trackPorts(plain);
    expect(JSON.stringify(draft)).toBe(JSON.stringify(plain));
    expect(untracked(draft)).toEqual(plain);
    expect(Object.getOwnPropertySymbols(untracked(draft).inputs[0])).toEqual([]);
  });

  it('says nothing when nothing about the ports changed', () => {
    const plain = node('n', [input('a')], [output('b')]);
    expect(portRenames(plain, trackPorts(plain))).toEqual({ inputs: {}, outputs: {} });
  });
});
