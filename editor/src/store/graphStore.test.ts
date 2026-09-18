import { describe, it, expect } from 'vitest';
import { useGraphStore } from './graphStore';
import type { Graph, GraphNode } from '@/graph';
import { createGuiWidget, guiWidgetPorts } from '@/elements/nodes/gui/guiWidgets';
import { baseNodeConfig } from '@/elements/nodes/baseNodeConfig';

// The same defaults every node type is created with. Copied out field by field
// here once, which meant adding a field to NodeConfig broke this file for a
// reason that had nothing to do with what it tests.
const blankConfig = baseNodeConfig;

function graphNode(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: 'n',
    node_type: 'input',
    label: 'Node',
    description: '',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    config: blankConfig(),
    ...overrides,
  };
}

function loadTestGraph(nodes: GraphNode[], edges: Graph['edges'] = []) {
  useGraphStore.getState().loadGraph({
    metadata: {
      name: 'Test', version: '1.0.0', description: '', author: '', tags: [],
      ai_defaults: { provider: 'default', model: '' },
  gui_scheme: 'night',
    },
    nodes,
    edges,
  });
}

describe('graphStore.currentFilePath', () => {
  it('resets to null on loadGraph, and can be set explicitly by the caller afterward', () => {
    useGraphStore.getState().setCurrentFilePath('/tmp/example.json');
    expect(useGraphStore.getState().currentFilePath).toBe('/tmp/example.json');

    loadTestGraph([]);
    expect(useGraphStore.getState().currentFilePath).toBeNull();

    useGraphStore.getState().setCurrentFilePath('/tmp/loaded.json');
    expect(useGraphStore.getState().currentFilePath).toBe('/tmp/loaded.json');
  });
});

describe('graphStore.updateNode edge pruning', () => {
  it('removes edges attached to ports no longer present after an update', () => {
    const w1 = createGuiWidget('input_picker', 'A');
    const w2 = createGuiWidget('input_picker', 'B');
    const guiNode = graphNode({
      id: 'gui1',
      node_type: 'gui',
      config: { ...blankConfig(), gui_widgets: [w1, w2] },
      ...guiWidgetPorts(w1),
    });
    guiNode.outputs = [...guiWidgetPorts(w1).outputs, ...guiWidgetPorts(w2).outputs];

    const sink = graphNode({
      id: 'sink',
      node_type: 'output',
      inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    });

    loadTestGraph(
      [guiNode, sink],
      [
        { id: 'e1', source_node_id: 'gui1', source_port_id: `${w1.id}_out`, target_node_id: 'sink', target_port_id: 'value' },
        { id: 'e2', source_node_id: 'gui1', source_port_id: `${w2.id}_out`, target_node_id: 'sink', target_port_id: 'value' },
      ]
    );

    expect(useGraphStore.getState().rfEdges).toHaveLength(2);

    // Simulate removing widget w2 -> outputs shrink to just w1's port.
    useGraphStore.getState().updateNode('gui1', {
      config: { ...blankConfig(), gui_widgets: [w1] },
      inputs: guiWidgetPorts(w1).inputs,
      outputs: guiWidgetPorts(w1).outputs,
    });

    const remainingEdges = useGraphStore.getState().rfEdges;
    expect(remainingEdges).toHaveLength(1);
    expect(remainingEdges[0].id).toBe('e1');
  });

  it('leaves edges alone when the update does not touch ports', () => {
    const a = graphNode({ id: 'a', outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }] });
    const b = graphNode({
      id: 'b',
      node_type: 'output',
      inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    });
    loadTestGraph([a, b], [{ id: 'e1', source_node_id: 'a', source_port_id: 'output', target_node_id: 'b', target_port_id: 'value' }]);

    useGraphStore.getState().updateNode('a', { label: 'Renamed' });

    expect(useGraphStore.getState().rfEdges).toHaveLength(1);
  });
});

describe('graphStore.loadGraph gui port sync', () => {
  it('regenerates a gui node\'s ports from its widget list even if stale ports were provided', () => {
    const widget = createGuiWidget('text_io', 'Text');
    const staleGui = graphNode({
      id: 'gui1',
      node_type: 'gui',
      config: { ...blankConfig(), gui_widgets: [widget] },
      inputs: [{ id: 'stale_in', name: 'Stale', kind: 'input', data_type: 'any', multi: false, required: false, description: '' }],
      outputs: [],
    });

    loadTestGraph([staleGui]);

    const loaded = useGraphStore.getState().rfNodes[0].data.graphNode;
    expect(loaded.inputs.map((p) => p.id)).toEqual([`${widget.id}_in`]);
    expect(loaded.outputs.map((p) => p.id)).toEqual([`${widget.id}_out`]);
  });
});

describe('graphStore width/height persistence', () => {
  it('round-trips node size through loadGraph -> exportGraph', () => {
    const node = graphNode({ id: 'n1', width: 320, height: 240 });
    loadTestGraph([node]);

    expect(useGraphStore.getState().rfNodes[0].width).toBe(320);
    expect(useGraphStore.getState().rfNodes[0].height).toBe(240);

    const exported = useGraphStore.getState().exportGraph();
    expect(exported.nodes[0].width).toBe(320);
    expect(exported.nodes[0].height).toBe(240);
  });
});

describe('graphStore: what a run remembered', () => {
  // Which values a run keeps is the engine's decision (engine/src/run.test.ts).
  // The store's part is to replay that list into its own long-lived copy of the
  // graph, so the next run starts from it -- and to do nothing else.
  const gui = (kind: 'text_io' | 'chat') => {
    const widget = createGuiWidget(kind, 'Block');
    const node = graphNode({
      id: 'gui1', node_type: 'gui',
      config: { ...blankConfig(), gui_widgets: [widget] },
      ...guiWidgetPorts(widget),
    });
    return { widget, node };
  };
  const stored = (widgetId: string) => useGraphStore.getState().rfNodes
    .find((n) => n.id === 'gui1')!.data.graphNode.config.gui_widgets.find((w) => w.id === widgetId)!;

  it('puts a data node\'s new value where the data node keeps it', () => {
    loadTestGraph([graphNode({ id: 'data1', node_type: 'data', config: { ...blankConfig(), data_value: 'old value' } })]);
    useGraphStore.getState().setExecutionResult({
      status: 'success', node_results: [],
      memory: [{ node_id: 'data1', port_id: 'input', value: 'new value' }],
    } as any);
    expect(useGraphStore.getState().rfNodes[0].data.graphNode.config.data_value).toBe('new value');
  });

  it('puts a value that came back around a loop into the block it arrived at', () => {
    const { widget, node } = gui('text_io');
    loadTestGraph([node]);
    useGraphStore.getState().setExecutionResult({
      status: 'success', node_results: [],
      memory: [{ node_id: 'gui1', port_id: `${widget.id}_in`, value: [{ x: 1, y: 2 }] }],
    } as any);
    // Structured values stay structured: a chart's points are not text.
    expect(stored(widget.id).value).toEqual([{ x: 1, y: 2 }]);
  });

  it('lets the block say what arriving means: a reply becomes a turn of the conversation', () => {
    const { widget, node } = gui('chat');
    widget.value = { messages: [], pending: 'hello' };
    loadTestGraph([node]);
    useGraphStore.getState().setExecutionResult({
      status: 'success', node_results: [],
      memory: [{ node_id: 'gui1', port_id: `${widget.id}_in`, value: 'hi there' }],
    } as any);
    expect(stored(widget.id).value).toEqual({
      messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi there' }],
      pending: '',
    });
  });

  it('keeps nothing the run did not say it kept', () => {
    const { widget, node } = gui('text_io');
    loadTestGraph([node]);
    useGraphStore.getState().setExecutionResult({
      status: 'success',
      node_results: [{ node_id: 'gui1', status: 'success', inputs: { [`${widget.id}_in`]: 'hello' }, outputs: {} }],
    } as any);
    expect(stored(widget.id).value).toBe('');
  });

  it('replays only the part of a merged result that is new', () => {
    // A page event re-ran half the graph; what is shown is the old result with
    // the new one laid over it. Replaying the old half again would add last
    // turn's answer to the conversation a second time.
    const { widget, node } = gui('chat');
    widget.value = { messages: [], pending: 'second' };
    loadTestGraph([node]);
    const write = (value: string) => ({ node_id: 'gui1', port_id: `${widget.id}_in`, value });
    const shown = { status: 'success', node_results: [], memory: [write('first answer'), write('second answer')] };
    const ran = { status: 'success', node_results: [], memory: [write('second answer')] };
    useGraphStore.getState().setExecutionResult(shown as any, ran as any);
    expect((stored(widget.id).value as { messages: unknown[] }).messages).toHaveLength(2);
  });
});
