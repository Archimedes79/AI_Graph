import { describe, it, expect } from 'vitest';
import { useGraphStore } from './graphStore';
import type { Graph, GraphNode } from '../types/graph';
import { createGuiWidget, guiWidgetPorts } from '../utils/guiWidgets';

function blankConfig() {
  return {
    prompt_at_runtime: false,
    input_mode: 'text' as const,
    select_all_files: true,
    selector_prompt: '',
    selector_code: '',
    ai_provider: 'ollama' as const,
    ai_model: 'llama3',
    gen_ai_provider: 'ollama' as const,
    gen_ai_model: 'llama3',
    system_prompt: '',
    temperature: 0.7,
    language: 'python',
    code: '',
    code_prompt: '',
    config_context_file: '',
    output_format: 'text' as const,
    output_format_prompt: '',
    output_context_file: '',
    output_label: 'Result',
    write_mode: 'none' as const,
    batch_mode: 'per_item' as const,
    separator: '\n',
    merge_mode: 'concat' as const,
    read_file_inputs: false,
    gui_widgets: [],
    gui_grid_columns: 12,
    gui_grid_row_height: 56,
    extra: {},
  };
}

function graphNode(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: 'n',
    node_type: 'text_input',
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
    metadata: { name: 'Test', version: '1.0.0', description: '', author: '', tags: [] },
    nodes,
    edges,
  });
}

describe('graphStore.updateNode edge pruning', () => {
  it('removes edges attached to ports no longer present after an update', () => {
    const w1 = createGuiWidget('file_open', 'A');
    const w2 = createGuiWidget('file_open', 'B');
    const guiNode = graphNode({
      id: 'gui1',
      node_type: 'gui',
      config: { ...blankConfig(), gui_widgets: [w1, w2] },
      ...guiWidgetPorts(w1),
    });
    guiNode.outputs = [...guiWidgetPorts(w1).outputs, ...guiWidgetPorts(w2).outputs];

    const sink = graphNode({
      id: 'sink',
      node_type: 'text_output',
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
      node_type: 'text_output',
      inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    });
    loadTestGraph([a, b], [{ id: 'e1', source_node_id: 'a', source_port_id: 'output', target_node_id: 'b', target_port_id: 'value' }]);

    useGraphStore.getState().updateNode('a', { label: 'Renamed' });

    expect(useGraphStore.getState().rfEdges).toHaveLength(1);
  });
});

describe('graphStore.loadGraph gui port sync', () => {
  it('regenerates a gui node\'s ports from its widget list even if stale ports were provided', () => {
    const widget = createGuiWidget('text_window', 'Text');
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

describe('graphStore deferred edge persistence', () => {
  it('round-trips deferred/initial_value through loadGraph -> exportGraph', () => {
    const a = graphNode({ id: 'a', outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }] });
    const b = graphNode({
      id: 'b',
      node_type: 'text_output',
      inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    });
    loadTestGraph([a, b], [
      { id: 'e1', source_node_id: 'a', source_port_id: 'output', target_node_id: 'b', target_port_id: 'value', deferred: true, initial_value: 'seed' },
      { id: 'e2', source_node_id: 'a', source_port_id: 'output', target_node_id: 'b', target_port_id: 'value' },
    ]);

    const exported = useGraphStore.getState().exportGraph();
    expect(exported.edges[0]).toMatchObject({ id: 'e1', deferred: true, initial_value: 'seed' });
    expect(exported.edges[1].deferred).toBeUndefined();
  });

  it('setEdgeFeedback marks an existing edge as deferred', () => {
    const a = graphNode({ id: 'a', outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }] });
    const b = graphNode({
      id: 'b',
      node_type: 'text_output',
      inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    });
    loadTestGraph([a, b], [{ id: 'e1', source_node_id: 'a', source_port_id: 'output', target_node_id: 'b', target_port_id: 'value' }]);

    useGraphStore.getState().setEdgeFeedback('e1', { deferred: true, initial_value: 'first' });

    const exported = useGraphStore.getState().exportGraph();
    expect(exported.edges[0]).toMatchObject({ deferred: true, initial_value: 'first' });
  });
});
