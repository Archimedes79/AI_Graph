import { describe, it, expect } from 'vitest';
import { shapeToKeep, useGraphStore } from './graphStore';
import type { Graph, GraphNode } from '@/graph';
import { guiWidgetPorts, syncGuiNodePorts } from '@/document/guiWidgets';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { NESTED_GRAPH_FIELD } from '@engine/project/changes.ts';
import { NODE_KINDS } from '@/document/nodeKinds';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { parseGraph, type GraphNode as EngineNode } from '@engine/graph.ts';
import { executeGraph } from '@engine/execution/executor.ts';

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
      name: 'Test', description: '',
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

describe('graphStore.newGraph', () => {
  it('starts from the engine\'s defaults, keeping nothing of the graph before it', () => {
    // "New graph" used to merge a name and four other keys into the old
    // metadata: a pinned AI and a colour scheme were saved into the new one,
    // and Undo brought the old graph's nodes back.
    loadTestGraph([graphNode({ id: 'old' })]);
    useGraphStore.getState().setMetadata({ ai_defaults: { provider: 'openai', model: 'gpt' }, gui_scheme: 'paper' });
    useGraphStore.getState().setCurrentFilePath('/tmp/old', true);
    useGraphStore.getState().setRFNodes([]);
    useGraphStore.getState().newGraph();
    const state = useGraphStore.getState();
    expect(state.metadata).toEqual(parseGraph({ nodes: [], edges: [] }).metadata);
    expect(state.rfNodes).toEqual([]);
    expect(state.past).toEqual([]);
    expect(state.currentFilePath).toBeNull();
    expect(state.isDirty()).toBe(false);
  });
});

describe('graphStore.updateNode edge pruning', () => {
  it('removes edges attached to ports no longer present after an update', () => {
    const w1 = WIDGET_BUILDERS.input_picker.create('A');
    const w2 = WIDGET_BUILDERS.input_picker.create('B');
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

  it('keeps the wire from a block\'s error port through a later edit of the page', () => {
    // What the designer does on every edit: the page's new blocks, their ports
    // synced, handed to updateNode -- whose pruning cut this wire as soon as
    // anybody renamed a block, because the synced ports had no `_error`.
    const pick = { ...WIDGET_BUILDERS.select.create('Pick'), catch_errors: true };
    const page = syncGuiNodePorts(graphNode({ id: 'gui1', node_type: 'gui', config: { ...blankConfig(), gui_widgets: [pick] } }));
    const sink = graphNode({
      id: 'sink',
      node_type: 'output',
      inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    });
    loadTestGraph([page, sink], [
      { id: 'e1', source_node_id: 'gui1', source_port_id: `${pick.id}_error`, target_node_id: 'sink', target_port_id: 'value' },
    ]);

    const stored = useGraphStore.getState().rfNodes.find((n) => n.id === 'gui1')!.data.graphNode;
    const renamed = { ...stored.config.gui_widgets[0], label: 'Choose' };
    useGraphStore.getState().updateNode('gui1', syncGuiNodePorts({ ...stored, config: { ...stored.config, gui_widgets: [renamed] } }));

    expect(useGraphStore.getState().rfEdges.map((edge) => edge.sourceHandle)).toEqual([`${pick.id}_error`]);
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
    const widget = WIDGET_BUILDERS.text_io.create('Text');
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

/**
 * A graph written by hand, by the MCP server or by a model leaves keys out, and
 * the engine reads each missing one some way. Opening such a graph and saving
 * it must not change what it does: the editor used to fill a missing key with
 * what a *new* node starts with, and then save that. A code node with no
 * batch_mode ran once on the whole list from the command line and once per
 * item after one Save in the editor; an output node with no label came back
 * keyed "Result" instead of by its id.
 *
 * The mirror of `elements/savedConfig.test.ts`: that one holds a saved node to
 * the full one, this one holds a loaded node to the file it was loaded from.
 * Not `config()` itself: it spells a setting as it is stored, and a missing
 * provider and 'default' are one and the same provider to a run.
 */
describe('graphStore.loadGraph: a key the file leaves out', () => {
  const QUESTIONS = [
    'batchMode', 'batchConcurrency', 'readsFileInputs', 'catchesErrors', 'needsInput',
    'derivedPorts', 'runtimeRequirements', 'referencedPaths', 'logic',
  ] as const;
  const answers = (node: GraphNode): Record<string, string> => {
    const element = engineRegistry.node(node.node_type) as unknown as Record<string, (node: EngineNode) => unknown>;
    return Object.fromEntries(QUESTIONS
      .filter((question) => typeof element[question] === 'function')
      .map((question) => [question, JSON.stringify(element[question](node as EngineNode)) ?? 'undefined']));
  };

  /** Each node type as a file might say it: its ports, and not one setting. */
  const bare = Object.values(NODE_KINDS).map((kind) => {
    const made = kind.create('n');
    return { ...made, config: {} as GraphNode['config'] };
  });

  it.each(bare.map((node) => [node.node_type, node]))(
    '%s: opened and saved, the engine runs it as the file said',
    (_type, node) => {
      loadTestGraph([node]);
      const saved = useGraphStore.getState().exportGraph().nodes[0];
      expect(answers(saved)).toEqual(answers(node));
    },
  );

  it('keeps two unlabelled outputs apart in the run\'s result, as the command line does', async () => {
    const text = (id: string, value: string) => ({ ...NODE_KINDS.input.create(id), config: { value } as GraphNode['config'] });
    const show = (id: string) => ({ ...NODE_KINDS.output.create(id), config: {} as GraphNode['config'] });
    const file: Graph = {
      metadata: { name: 'T', description: '', ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night' },
      nodes: [text('a', 'alpha'), text('b', 'beta'), show('first'), show('second')],
      edges: [
        { id: 'e1', source_node_id: 'a', source_port_id: 'output', target_node_id: 'first', target_port_id: 'value' },
        { id: 'e2', source_node_id: 'b', source_port_id: 'output', target_node_id: 'second', target_port_id: 'value' },
      ],
    };
    const run = async (graph: Graph) => Object.keys((await executeGraph(parseGraph(JSON.parse(JSON.stringify(graph))), {
      registry: engineRegistry,
      runtime: {
        files: { resolve: (path) => path, exists: async () => false, read: async () => '', write: async () => {}, list: async () => [] },
        code: { run: async () => ({}) },
        ai: { complete: async () => '' },
      },
    })).outputs).sort();

    useGraphStore.getState().loadGraph(file);
    expect(await run(useGraphStore.getState().exportGraph())).toEqual(await run(file));
  });

  it('still starts a node made in the editor per item, and keys its output "Result"', () => {
    loadTestGraph([]);
    const code = useGraphStore.getState().addNode('code', { x: 0, y: 0 });
    const output = useGraphStore.getState().addNode('output', { x: 0, y: 0 });
    const saved = useGraphStore.getState().exportGraph().nodes;
    expect(saved.find((node) => node.id === code)!.config.batch_mode).toBe('per_item');
    expect(saved.find((node) => node.id === output)!.config).toMatchObject({ output_label: 'Result', write_mode: 'window' });
  });

  it('writes "once per item" only on the kinds that can run so', () => {
    // It used to be saved on every node, and an output node writing to a file
    // then wrote each item of a list over the last.
    loadTestGraph([]);
    const ids = (['ai', 'code', 'output', 'data', 'gui', 'input', 'subgraph', 'trigger'] as const)
      .map((type) => [type, useGraphStore.getState().addNode(type, { x: 0, y: 0 })] as const);
    const saved = useGraphStore.getState().exportGraph().nodes;
    const perItem = ids.filter(([, id]) => 'batch_mode' in saved.find((node) => node.id === id)!.config).map(([type]) => type);
    expect(perItem).toEqual(['ai', 'code']);
  });

  it('labels each new output node its own way, as check asks', () => {
    // `check` reports two outputs sharing a label, and save_graph refuses them.
    loadTestGraph([graphNode({ id: 'kept', node_type: 'output', config: { output_label: 'Result 2' } as GraphNode['config'] })]);
    const labels = [0, 1, 2].map(() => useGraphStore.getState().addNode('output', { x: 0, y: 0 }))
      .map((id) => useGraphStore.getState().exportGraph().nodes.find((node) => node.id === id)!.config.output_label);
    expect(labels).toEqual(['Result', 'Result 3', 'Result 4']);
  });

  it('writes no output_format on a new node, and keeps an older one\'s as it was', () => {
    // A choice nothing offers any more: 'text' was saved into every ai and code node.
    loadTestGraph([graphNode({ id: 'old', node_type: 'ai', config: { output_format: 'json' } as GraphNode['config'] })]);
    const ai = useGraphStore.getState().addNode('ai', { x: 0, y: 0 });
    const code = useGraphStore.getState().addNode('code', { x: 0, y: 0 });
    const saved = useGraphStore.getState().exportGraph().nodes;
    expect(saved.find((node) => node.id === ai)!.config).not.toHaveProperty('output_format');
    expect(saved.find((node) => node.id === code)!.config).not.toHaveProperty('output_format');
    expect(saved.find((node) => node.id === 'old')!.config.output_format).toBe('json');
  });

  it('keeps an older file\'s batch_mode on another kind as it was, unread', () => {
    loadTestGraph([graphNode({ id: 'shown', node_type: 'output', config: { batch_mode: 'per_item' } as GraphNode['config'] })]);
    expect(useGraphStore.getState().exportGraph().nodes[0].config.batch_mode).toBe('per_item');
  });

  it('keeps what the file did say', () => {
    loadTestGraph([graphNode({ id: 'each', node_type: 'code', config: { batch_mode: 'per_item' } as GraphNode['config'] })]);
    expect(useGraphStore.getState().exportGraph().nodes[0].config.batch_mode).toBe('per_item');
  });
});

describe('graphStore width/height persistence', () => {
  it('round-trips node size through loadGraph -> exportGraph', () => {
    const node = graphNode({ id: 'n1', width: 320, height: 240 });
    loadTestGraph([node]);

    // On `style`: that is what ReactFlow lays the node out from. A node's own
    // `width`/`height` are where it reports what it measured, so a size put
    // there is ignored and then overwritten.
    expect(useGraphStore.getState().rfNodes[0].style).toMatchObject({ width: 320, height: 240 });

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
    const widget = WIDGET_BUILDERS[kind].create('Block');
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
    } as never);
    expect(useGraphStore.getState().rfNodes[0].data.graphNode.config.data_value).toBe('new value');
  });

  it('puts a value that came back around a loop into the block it arrived at', () => {
    const { widget, node } = gui('text_io');
    // A box that only shows: what arrives is all it holds. One a person also
    // types into keeps what they typed -- the case below.
    widget.mode = 'output';
    loadTestGraph([node]);
    useGraphStore.getState().setExecutionResult({
      status: 'success', node_results: [],
      memory: [{ node_id: 'gui1', port_id: `${widget.id}_in`, value: [{ x: 1, y: 2 }] }],
    } as never);
    // Structured values stay structured: a chart's points are not text.
    expect(stored(widget.id).value).toEqual([{ x: 1, y: 2 }]);
  });

  it('leaves what a person typed in a box they type into, whatever came back around the loop', () => {
    // The reply is shown from what the run delivered. Kept as the box's value,
    // it was the next message: the model's answer sent back as the person's.
    const { widget, node } = gui('text_io');
    widget.value = 'my question';
    loadTestGraph([node]);
    useGraphStore.getState().setExecutionResult({
      status: 'success', node_results: [],
      memory: [{ node_id: 'gui1', port_id: `${widget.id}_in`, value: 'the model reply' }],
    } as never);
    expect(stored(widget.id).value).toBe('my question');
  });

  it('lets the block say what arriving means: a reply becomes a turn of the conversation', () => {
    const { widget, node } = gui('chat');
    widget.value = { messages: [], pending: 'hello' };
    loadTestGraph([node]);
    useGraphStore.getState().setExecutionResult({
      status: 'success', node_results: [],
      memory: [{ node_id: 'gui1', port_id: `${widget.id}_in`, value: 'hi there' }],
    } as never);
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
    } as never);
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
    useGraphStore.getState().setExecutionResult(shown as never, ran as never);
    expect((stored(widget.id).value as { messages: unknown[] }).messages).toHaveLength(2);
  });
});

describe('graphStore, a project open on disk', () => {
  const codeNode = () => graphNode({
    id: 'count', node_type: 'code',
    outputs: [{ id: 'total', name: 'Total', kind: 'output', data_type: 'any', multi: false, required: false, description: '' }],
    config: { ...blankConfig(), code: 'function run() { return { total: 1 }; }' },
  });
  const nodeById = (id: string) => useGraphStore.getState().rfNodes.find((n) => n.id === id)!.data.graphNode;

  it('knows it is a project only while a path says so', () => {
    useGraphStore.getState().setCurrentFilePath('/work/tool', true);
    expect(useGraphStore.getState().isProject).toBe(true);
    loadTestGraph([]);
    expect(useGraphStore.getState().isProject).toBe(false);
    useGraphStore.getState().setCurrentFilePath('/work/tool.json');
    expect(useGraphStore.getState().isProject).toBe(false);
  });

  it('takes code changed on disk in as one undo step, and a clean graph stays clean', () => {
    const page = graphNode({ id: 'page', node_type: 'gui', config: { ...blankConfig(), gui_widgets: [{ ...WIDGET_BUILDERS.plot_window.create('Chart'), id: 'chart' }] } });
    loadTestGraph([codeNode(), page]);
    useGraphStore.getState().markSaved();

    useGraphStore.getState().takeDiskChanges([
      { node_id: 'count', widget_id: '', field: 'code', value: 'function run() { return { total: 2 }; }' },
      { node_id: 'page', widget_id: 'chart', field: 'code', value: 'function run(i) { return i; }' },
      { node_id: 'gone', widget_id: '', field: 'code', value: 'ignored' },
    ]);
    expect(nodeById('count').config.code).toContain('total: 2');
    expect(nodeById('page').config.gui_widgets[0].code).toContain('return i');
    expect(useGraphStore.getState().isDirty()).toBe(false);

    useGraphStore.getState().undo();
    expect(nodeById('count').config.code).toContain('total: 1');
  });

  it('keeps unsaved edits unsaved when a change comes in from disk', () => {
    loadTestGraph([codeNode()]);
    useGraphStore.getState().markSaved();
    useGraphStore.getState().updateNode('count', { label: 'Renamed here' });
    useGraphStore.getState().takeDiskChanges([{ node_id: 'count', widget_id: '', field: 'code_prompt', value: 'Count.' }]);
    expect(useGraphStore.getState().isDirty()).toBe(true);
    expect(nodeById('count').label).toBe('Renamed here');
  });

  it('sets a code node\'s output interface from its first successful run, and keeps it after', () => {
    loadTestGraph([codeNode()]);
    const ran = (total: unknown) => useGraphStore.getState().setExecutionResult({
      status: 'success', outputs: {}, error: null,
      node_results: [{ node_id: 'count', status: 'success', inputs: {}, outputs: { total }, error: null }],
    });
    ran(7);
    expect(nodeById('count').config.output_schema).toEqual({ type: 'object', properties: { total: { type: 'integer' } }, required: ['total'] });
    ran('seven');
    expect(nodeById('count').config.output_schema).toMatchObject({ properties: { total: { type: 'integer' } } });
  });

  it('keeps a measured shape by one rule, whoever measured it: once, of something, for a node that keeps one', () => {
    // The run, the dialog's ✨ and the sweep's each wrote their own copy of it.
    const code = NODE_KINDS.code.create('c');
    expect(shapeToKeep(code, { total: 1 })).toMatchObject({ properties: { total: { type: 'integer' } } });
    expect(shapeToKeep(code, {})).toBeUndefined();
    expect(shapeToKeep(code, undefined)).toBeUndefined();
    expect(shapeToKeep({ ...code, config: { ...code.config, output_schema: { type: 'object' } } }, { total: 1 })).toBeUndefined();
    expect(shapeToKeep(NODE_KINDS.data.create('d'), { output: 1 })).toBeUndefined();
  });
});

describe('graphStore, a graph just opened', () => {
  const store = () => useGraphStore.getState();
  /** What ReactFlow does once a node is drawn: it reports what the node measured. */
  const measured = (id: string, width: number, height: number) =>
    store().setRFNodes(store().rfNodes.map((n) => (n.id === id ? { ...n, width, height } : n)));
  /** What its resizer does when someone drags a corner: `updateStyle: true`, so the style changes. */
  const resized = (id: string, width: number, height: number) =>
    store().setRFNodes(store().rfNodes.map(
      (n) => (n.id === id ? { ...n, width, height, style: { ...n.style, width, height } } : n),
    ));

  const openWithPage = () => {
    const page = graphNode({ id: 'page', node_type: 'gui', width: 340, height: 300, config: { ...blankConfig(), gui_widgets: [] } });
    loadTestGraph([graphNode({ id: 'count', node_type: 'code' }), page]);
  };

  it('gives the canvas the size a page was saved with', () => {
    // In `style`, because that is what ReactFlow renders from. Put on the node
    // itself it was ignored and then overwritten by the measurement, so a page
    // saved at 340x300 opened at whatever its contents came to.
    openWithPage();
    expect(store().rfNodes.find((n) => n.id === 'page')!.style).toMatchObject({ width: 340, height: 300 });
    expect(store().rfNodes.find((n) => n.id === 'count')!.style).toBeUndefined();
  });

  it('stays saved when the canvas measures its nodes', () => {
    // The bug this is here for: every project read as "unsaved" the moment it
    // was opened, because the measurement was written back into the graph. It
    // is not cosmetic -- `takeDiskChanges` refuses a nested subgraph from disk
    // unless the document is clean, so that path was dead from the first frame.
    openWithPage();
    measured('page', 675, 366);
    measured('count', 212, 96);
    expect(store().isDirty()).toBe(false);
    const exported = store().exportGraph();
    expect(exported.nodes.find((n) => n.id === 'count')!.width).toBeUndefined();
    expect(exported.nodes.find((n) => n.id === 'page')).toMatchObject({ width: 340, height: 300 });
  });

  it('keeps a size someone actually dragged', () => {
    openWithPage();
    measured('page', 675, 366);
    resized('page', 480, 260);
    expect(store().isDirty()).toBe(true);
    expect(store().exportGraph().nodes.find((n) => n.id === 'page')).toMatchObject({ width: 480, height: 260 });
  });
});

/**
 * Going into a node that holds a graph. One document is open at a time and the
 * canvas does not know the difference -- what changes is which graph it shows,
 * and that is the whole mechanism.
 */
describe('a graph inside a node', () => {
  const inner = (nodes: unknown[] = []) => ({
    metadata: {
      name: 'Inner', description: '',
      ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night',
    },
    nodes,
    edges: [],
  });

  const holder = (held: unknown = inner()) => graphNode({
    id: 'part', node_type: 'subgraph', label: 'Part',
    config: { ...blankConfig(), subgraph: held },
  });

  const store = () => useGraphStore.getState();

  it('opens what the node holds, and puts back what was built in there', () => {
    loadTestGraph([holder()]);
    store().markSaved();

    store().openSubgraph('part');
    expect(store().rfNodes).toHaveLength(0);
    expect(store().metadata.name).toBe('Inner');

    store().addNode('output', { x: 0, y: 0 });
    store().closeSubgraph();

    // Back outside, with the node holding what was added -- and an output node
    // in there is an output port out here.
    expect(store().metadata.name).toBe('Test');
    const node = store().rfNodes[0].data.graphNode;
    expect((node.config.subgraph as Graph).nodes).toHaveLength(1);
    expect(node.outputs).toHaveLength(1);
  });

  it('is unsaved work like any other, measured on the whole document', () => {
    loadTestGraph([holder()]);
    store().markSaved();
    expect(store().isDirty()).toBe(false);

    store().openSubgraph('part');
    // Going in changes nothing.
    expect(store().isDirty()).toBe(false);

    store().addNode('output', { x: 0, y: 0 });
    // A change in there is a change, seen from in there.
    expect(store().isDirty()).toBe(true);

    // And saving from in there saves the whole thing.
    store().markSaved();
    expect(store().isDirty()).toBe(false);
    store().closeSubgraph();
    expect(store().isDirty()).toBe(false);
  });

  it('gives each level its own undo, and lets neither reach the other', () => {
    loadTestGraph([holder()]);
    store().openSubgraph('part');
    expect(store().past).toHaveLength(0);

    store().addNode('output', { x: 0, y: 0 });
    expect(store().past.length).toBeGreaterThan(0);
    store().undo();
    expect(store().rfNodes).toHaveLength(0);

    store().closeSubgraph();
    // Outside, the history is the one that was left here.
    expect(store().past).toHaveLength(0);
    expect(store().rfNodes.map((n) => n.id)).toEqual(['part']);
  });

  it('folds every level up, however deep', () => {
    loadTestGraph([holder(inner([{ ...holder(), id: 'deeper', label: 'Deeper' }]))]);
    store().openSubgraph('part');
    store().openSubgraph('deeper');
    store().addNode('output', { x: 0, y: 0 });

    const root = store().rootGraph();
    const middle = root.nodes[0].config.subgraph as Graph;
    const bottom = middle.nodes[0].config.subgraph as Graph;
    expect(bottom.nodes).toHaveLength(1);
    // And what `rootGraph` says is what closing twice leaves behind.
    store().closeSubgraph();
    store().closeSubgraph();
    expect(JSON.stringify(store().exportGraph())).toBe(JSON.stringify(root));
  });

  it('takes the whole graph back when its folder changed on disk, ports and all', () => {
    loadTestGraph([holder()]);
    store().markSaved();

    // What the engine reports for a node whose folder changed: the graph it
    // holds, whole. An output node appeared in there while we were away.
    store().takeDiskChanges([{
      node_id: 'part',
      widget_id: '',
      field: NESTED_GRAPH_FIELD,
      value: inner([graphNode({ id: 'result', node_type: 'output', label: 'Result' })]),
    }]);

    const node = store().rfNodes[0].data.graphNode;
    expect((node.config.subgraph as Graph).nodes.map((n) => n.id)).toEqual(['result']);
    // The ports follow the graph inside, here as everywhere else.
    expect(node.outputs.map((port) => port.name)).toEqual(['Result']);
    // What is on disk is saved by definition.
    expect(store().isDirty()).toBe(false);
  });

  it('makes everything done in there one step out here', () => {
    loadTestGraph([holder()]);
    store().openSubgraph('part');
    store().addNode('output', { x: 0, y: 0 });
    store().addNode('code', { x: 0, y: 0 });
    store().closeSubgraph();

    // One Ctrl+Z used to throw away everything built inside, because nothing
    // in there had ever been a step out here.
    expect(store().past.length).toBeGreaterThan(0);
    const built = (store().rfNodes[0].data.graphNode.config.subgraph as Graph).nodes.length;
    expect(built).toBe(2);
    store().undo();
    expect((store().rfNodes[0].data.graphNode.config.subgraph as Graph).nodes).toHaveLength(0);
    store().redo();
    expect((store().rfNodes[0].data.graphNode.config.subgraph as Graph).nodes).toHaveLength(2);
  });

  it('costs no undo step when nothing was changed in there', () => {
    loadTestGraph([holder()]);
    store().openSubgraph('part');
    store().closeSubgraph();
    expect(store().past).toHaveLength(0);
  });

  it('comes back out to the top, one level at a time', () => {
    loadTestGraph([holder(inner([{ ...holder(), id: 'deeper', label: 'Deeper' }]))]);
    store().openSubgraph('part');
    store().openSubgraph('deeper');
    store().closeSubgraphsTo(0);
    expect(store().subgraphStack).toHaveLength(0);
    expect(store().rfNodes.map((n) => n.id)).toEqual(['part']);
  });

  it('stops where a level will not close, rather than asking forever', () => {
    // A run in flight keeps the level it runs on open. Asked in a loop until
    // the stack is short enough, that loop never ended.
    loadTestGraph([holder()]);
    store().openSubgraph('part');
    useGraphStore.setState({ isExecuting: true });
    store().closeSubgraphsTo(0);
    expect(store().subgraphStack).toHaveLength(1);
    useGraphStore.setState({ isExecuting: false });
  });

  it('will not change level while a run is in flight', () => {
    loadTestGraph([holder()]);
    useGraphStore.setState({ isExecuting: true });
    store().openSubgraph('part');
    expect(store().subgraphStack).toHaveLength(0);
    useGraphStore.setState({ isExecuting: false });
  });

  it('leaves nothing of the level behind when it swaps', () => {
    loadTestGraph([holder()]);
    useGraphStore.setState({
      textOutputWindows: [{ nodeId: 'part', label: 'Result', content: 'from the level above' }],
    });
    store().openSubgraph('part');
    expect(store().textOutputWindows).toEqual([]);
  });

  it('leaves a graph changed on disk alone while there is unsaved work here', () => {
    loadTestGraph([holder()]);
    store().markSaved();
    store().addNode('output', { x: 0, y: 0 });   // unsaved work, out here

    const refused = store().takeDiskChanges([{
      node_id: 'part', widget_id: '', field: NESTED_GRAPH_FIELD, value: inner([graphNode({ id: 'theirs' })]),
    }]);

    // Taking it would have replaced that whole graph without a word.
    expect(refused).toEqual(['part']);
    expect((store().rfNodes[0].data.graphNode.config.subgraph as Graph).nodes).toHaveLength(0);
  });

  it('drops the frames when a different document is opened', () => {
    loadTestGraph([holder()]);
    store().openSubgraph('part');
    loadTestGraph([graphNode({ id: 'other' })]);
    expect(store().subgraphStack).toHaveLength(0);
    expect(store().rootGraph().nodes.map((n) => n.id)).toEqual(['other']);
  });
});

describe('graphStore.connect', () => {
  const port = (id: string, kind: 'input' | 'output') => ({ id, name: id, kind, data_type: 'any' as const, multi: false, required: false, description: '' });
  const nodes = () => [
    graphNode({ id: 'a', node_type: 'code', outputs: [port('out', 'output')] }),
    graphNode({ id: 'b', node_type: 'code', inputs: [port('in', 'input')] }),
  ];

  it('names a new wire the way flow.json writes it', () => {
    loadTestGraph(nodes());
    useGraphStore.getState().connect({ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' });
    expect(useGraphStore.getState().rfEdges.map((edge) => edge.id)).toEqual(['a.out -> b.in']);
  });

  it('does not draw a wire twice, whatever the one already there is called', () => {
    // A wire read from an older file keeps the id it was saved with.
    loadTestGraph(nodes(), [{ id: 'e1', source_node_id: 'a', source_port_id: 'out', target_node_id: 'b', target_port_id: 'in' }]);
    useGraphStore.getState().connect({ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' });
    expect(useGraphStore.getState().rfEdges).toHaveLength(1);
  });
});
