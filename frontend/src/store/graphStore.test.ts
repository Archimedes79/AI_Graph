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
    ai_provider: 'default' as const,
    ai_model: '',
    system_prompt: '',
    temperature: 0.7,
    language: 'python',
    code: '',
    code_prompt: '',
    data_value: null,
    data_format: 'text' as const,
    data_prompt: '',
    data_format_prompt: '',
    config_context_file: '',
    output_format: 'text' as const,
    output_format_prompt: '',
    output_context_file: '',
    output_label: 'Result',
    write_mode: 'none' as const,
    batch_mode: 'per_item' as const,
    batch_concurrency: 0,
    read_file_inputs: false,
    gui_widgets: [],
    gui_grid_columns: 12,
    extra: {},
  };
}

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

describe('graphStore memory-feedback settle', () => {
  it('persists an acyclic data-node update for the next run', () => {
    const data = graphNode({ id: 'data1', node_type: 'data', config: { ...blankConfig(), data_value: 'old value' } });
    loadTestGraph([data]);

    useGraphStore.getState().setExecutionResult({
      status: 'success',
      node_results: [{ node_id: 'data1', status: 'success', inputs: { input: 'new value' }, outputs: { output: 'new value' } }],
    } as any);

    const loadedData = useGraphStore.getState().rfNodes[0].data.graphNode;
    expect(loadedData.config.data_value).toBe('new value');
  });

  it('persists a cycle-closing edge into a data node for the next run', () => {
    const data = graphNode({
      id: 'data1',
      node_type: 'data',
      inputs: [{ id: 'input', name: 'Update', kind: 'input', data_type: 'any', multi: false, required: false, description: '' }],
      outputs: [{ id: 'output', name: 'Value', kind: 'output', data_type: 'any', multi: false, required: false, description: '' }],
      config: { ...blankConfig(), data_value: 'old value' },
    });
    const code = graphNode({
      id: 'code1',
      node_type: 'code',
      inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'any', multi: false, required: false, description: '' }],
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'any', multi: false, required: false, description: '' }],
    });
    loadTestGraph([data, code], [
      { id: 'read', source_node_id: 'data1', source_port_id: 'output', target_node_id: 'code1', target_port_id: 'input' },
      { id: 'write', source_node_id: 'code1', source_port_id: 'output', target_node_id: 'data1', target_port_id: 'input' },
    ]);

    useGraphStore.getState().setExecutionResult({
      status: 'success',
      node_results: [
        { node_id: 'data1', status: 'success', inputs: {}, outputs: { output: 'old value' } },
        { node_id: 'code1', status: 'success', inputs: {}, outputs: { output: 'new value' } },
      ],
    } as any);

    const loadedData = useGraphStore.getState().rfNodes.find((node) => node.id === 'data1')!.data.graphNode;
    expect(loadedData.config.data_value).toBe('new value');
  });

  it('persists a cycle-closing edge\'s fresh value into the target widget for the next run', () => {
    const widget = createGuiWidget('text_io', 'Answer');
    const gui = graphNode({
      id: 'gui1',
      node_type: 'gui',
      config: { ...blankConfig(), gui_widgets: [widget] },
      ...guiWidgetPorts(widget),
    });
    const code = graphNode({
      id: 'code1',
      node_type: 'code',
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    });

    loadTestGraph([gui, code], [
      { id: 'e1', source_node_id: 'gui1', source_port_id: `${widget.id}_out`, target_node_id: 'code1', target_port_id: 'value' },
      { id: 'e2', source_node_id: 'code1', source_port_id: 'output', target_node_id: 'gui1', target_port_id: `${widget.id}_in` },
    ]);

    useGraphStore.getState().setExecutionResult({
      status: 'success',
      node_results: [
        { node_id: 'gui1', status: 'success', inputs: {}, outputs: {} },
        { node_id: 'code1', status: 'success', inputs: {}, outputs: { output: 'fresh answer' } },
      ],
    } as any);

    const loadedGui = useGraphStore.getState().rfNodes.find((n) => n.id === 'gui1')!.data.graphNode;
    const loadedWidget = loadedGui.config.gui_widgets.find((w) => w.id === widget.id)!;
    expect(loadedWidget.value).toBe('fresh answer');
  });

  it('does not persist a plain (non-cycle-closing) edge into the target widget', () => {
    const widget = createGuiWidget('text_io', 'Display');
    const gui = graphNode({
      id: 'gui1',
      node_type: 'gui',
      config: { ...blankConfig(), gui_widgets: [widget] },
      ...guiWidgetPorts(widget),
    });
    const code = graphNode({
      id: 'code1',
      node_type: 'code',
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    });

    loadTestGraph([code, gui], [
      { id: 'e1', source_node_id: 'code1', source_port_id: 'output', target_node_id: 'gui1', target_port_id: `${widget.id}_in` },
    ]);

    useGraphStore.getState().setExecutionResult({
      status: 'success',
      node_results: [
        { node_id: 'code1', status: 'success', inputs: {}, outputs: { output: 'hello' } },
        { node_id: 'gui1', status: 'success', inputs: { [`${widget.id}_in`]: 'hello' }, outputs: {} },
      ],
    } as any);

    const loadedGui = useGraphStore.getState().rfNodes.find((n) => n.id === 'gui1')!.data.graphNode;
    const loadedWidget = loadedGui.config.gui_widgets.find((w) => w.id === widget.id)!;
    expect(loadedWidget.value).toBe('');
  });

  it('preserves structured feedback values for the next run', () => {
    const widget = createGuiWidget('text_io', 'Structured');
    const gui = graphNode({
      id: 'gui1',
      node_type: 'gui',
      config: { ...blankConfig(), gui_widgets: [widget] },
      ...guiWidgetPorts(widget),
    });
    const code = graphNode({
      id: 'code1',
      node_type: 'code',
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'json', multi: false, required: false, description: '' }],
    });

    loadTestGraph([gui, code], [
      { id: 'e1', source_node_id: 'gui1', source_port_id: `${widget.id}_out`, target_node_id: 'code1', target_port_id: 'value' },
      { id: 'e2', source_node_id: 'code1', source_port_id: 'output', target_node_id: 'gui1', target_port_id: `${widget.id}_in` },
    ]);

    const payload = [{ x: 1, y: 2 }];
    useGraphStore.getState().setExecutionResult({
      status: 'success',
      node_results: [
        { node_id: 'gui1', status: 'success', inputs: {}, outputs: {} },
        { node_id: 'code1', status: 'success', inputs: {}, outputs: { output: payload } },
      ],
    } as any);

    const loadedGui = useGraphStore.getState().rfNodes.find((n) => n.id === 'gui1')!.data.graphNode;
    const loadedWidget = loadedGui.config.gui_widgets.find((w) => w.id === widget.id)!;
    expect(loadedWidget.value).toEqual(payload);
  });
});

