import { beforeEach, describe, it, expect } from 'vitest';
import { useGraphStore } from '@/store/graphStore';
import type { Graph, GraphNode, GuiWidget, NodeType, Port, WidgetKind } from '@/graph';
import { withPorts } from '@/canvas/nodeDraft';
import { nodeDialog } from '@/canvas/nodeDialog';
import { newBlock } from '@/page/DesignerPalette';
import { pageOf } from '@/page/GuiPage';
import { insertBlock, patchBlock } from '@/page/pageWrite';
import { listPorts, withPerItem } from '@/authoring/nodeStepRules';
import { readPair } from '@/authoring/examplePair';
import { executeGraph } from '@engine/execution/executor.ts';
import { registry } from '@engine/elements/registry.ts';
import { problemsIn } from '@engine/project/check.ts';
import { readFilePorts } from '@/authoring/generationContext';
import { parseGraph } from '@engine/graph.ts';
import { graphFrom } from '@engine/project/flow.ts';
import type { Runtime } from '@engine/elements/Runtime.ts';

/**
 * The three master examples, built by hand.
 *
 * A plotter, a folder of summaries, a chat: each is a page and one node, and
 * each is put together here the way a person puts it together -- blocks added
 * to the page (the first one makes it), a node dropped on the canvas, a setting
 * changed in a dialog, a wire dragged from one port to another. No mouse, no browser, and no copy of what
 * the editor's handlers do: a block comes from the palette's `newBlock` and
 * reaches the page through `insertBlock` and `patchBlock`, a node's dialog is
 * its own `nodeDialog` -- changed as its ports editor and its fields change it,
 * and written into the graph as it writes -- and a wire is the store's
 * `connect`: the functions the designer and the node dialog call. What stays
 * in the components -- which row was clicked -- is left out.
 *
 * Then three questions, of each:
 *   - is what was built sound (`check` finds nothing)?
 *   - is it *the example*: the same blocks, the same wires, as the folder in
 *     `examples/` that people open first?
 *   - does it work: run on a file, a folder, a message, does the page show it?
 *
 * The second is what keeps the examples honest. An example somebody can open
 * but could not have built -- a port type no dialog sets, a wire no handle
 * offers -- is a trick, and this is where it is caught.
 */

const FLOWS = import.meta.glob('../../examples/*/flow.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const NODE_FILES = import.meta.glob('../../examples/*/nodes/*/{node,interface}.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const BODIES = import.meta.glob('../../examples/*/nodes/*/code.js', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
/** An example as the engine puts it together from its folder: the flow, and each node's own files. */
const example = (name: string): Graph => graphFrom(
  FLOWS[`../../examples/${name}/flow.json`],
  (id) => ({
    about: NODE_FILES[`../../examples/${name}/nodes/${id}/node.json`],
    ports: NODE_FILES[`../../examples/${name}/nodes/${id}/interface.json`],
  }),
  name,
) as unknown as Graph;
const bodyOf = (name: string, node: string): string => BODIES[`../../examples/${name}/nodes/${node}/code.js`];

// ── What a person does ────────────────────────────────────────────────────

const store = () => useGraphStore.getState();
const nodeOf = (id: string): GraphNode => store().rfNodes.find((node) => node.id === id)!.data.graphNode as GraphNode;

/** Drop a node on the canvas. */
const drop = (type: NodeType, x: number): string => store().addNode(type, { x, y: 160 });

const pageNow = () => pageOf(store().rfNodes.map((node) => node.data.graphNode as GraphNode));
/** The page's node: there is none to drop, the page's first block made it. */
const pageId = (): string => pageNow().page!.id;

/**
 * Add a block to the page from the palette, then set what its panel sets: the
 * designer's own steps (`newBlock`, `insertBlock`, then `patchBlock`).
 */
function addBlock(kind: WidgetKind, mode: string | undefined, settings: Partial<GuiWidget>): string {
  const block = newBlock(kind, mode, pageNow().blocks.map((b) => b.widget.id));
  insertBlock(block);
  patchBlock(block.id, settings);
  return block.id;
}

/**
 * Open a node's dialog and set what it asks: its name, what its ports are
 * called, its settings -- and step 1's "Run once per item", ticked or not,
 * which sets how the node runs and which inputs fan out and which outputs hand
 * on a list, together (`withPerItem`), for the lists step 1 sees arriving.
 * Port *types* no dialog sets, but a wire from a picker ticks "Read the file
 * at this path". *needed* ticks step 1's "needed" on those inputs
 * (`PortsEditor`), which sets `required` on the port.
 *
 * Done through the dialog's own `nodeDialog`: each change as its ports editor
 * and its fields make it, and written into the graph as it writes -- closed.
 */
function edit(nodeId: string, changes: {
  label: string; input?: string[]; output?: string; config?: Record<string, unknown>; perItem?: boolean; needed?: string[];
}): void {
  const dialog = nodeDialog(nodeId);
  // A row renamed in the ports editor; past the last row, one added with + and then named.
  const renamed = (ports: Port[], names: string[], kind: Port['kind']) => names.map((name, index) => ({
    ...(ports[index] ?? { kind, data_type: 'any', multi: false, required: false, description: '' }), id: name, name,
  }));
  dialog.change((draft) => withPorts(draft, {
    inputs: (changes.input ? renamed(draft.inputs, changes.input, 'input') : draft.inputs)
      .map((port) => (changes.needed?.includes(port.id) ? { ...port, required: true } : port)),
    outputs: changes.output ? renamed(draft.outputs, [changes.output], 'output') : draft.outputs,
  }));
  dialog.change((draft) => ({ ...draft, label: changes.label }));
  for (const [key, value] of Object.entries(changes.config ?? {})) dialog.setConfig(key, value);
  if (changes.perItem !== undefined) {
    const shown = dialog.node()!;
    const lists = listPorts(shown, readPair(shown.config.examples).input, store().rfNodes.map((item) => item.data.graphNode), store().rfEdges);
    // The box is there only when a list arrives; a new code or ai node's input is declared one.
    expect(lists.length).toBeGreaterThan(0);
    dialog.change((draft) => withPerItem(draft, changes.perItem!, lists));
  }
  dialog.write();
}

/** Drag a wire from one handle to another. */
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): void =>
  store().connect({ source, sourceHandle, target, targetHandle });

// ── What is compared, and what runs ───────────────────────────────────────

/** A graph as its shape: ids are made up on the spot, so blocks and wires are named by what they are. */
function shapeOf(graph: Graph): { nodes: string[]; blocks: string[]; wires: string[]; lists: string[]; needed: string[] } {
  const name = new Map<string, string>();
  for (const node of graph.nodes) name.set(node.id, node.node_type);
  const portName = (nodeId: string, portId: string): string => {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId)!;
    const block = (node.config.gui_widgets ?? []).find((widget: GuiWidget) => portId.startsWith(`${widget.id}_`));
    return block ? `${block.kind}${portId.slice(block.id.length)}` : portId;
  };
  return {
    nodes: graph.nodes.map((node) => node.node_type).sort(),
    blocks: graph.nodes.flatMap((node) => (node.config.gui_widgets ?? []).map((widget: GuiWidget) => `${widget.kind}${widget.mode ? `/${widget.mode}` : ''}${widget.run_on_change ? ' ⚡' : ''}`)),
    wires: graph.edges.map((edge) => `${name.get(edge.source_node_id)}.${portName(edge.source_node_id, edge.source_port_id)} -> ${name.get(edge.target_node_id)}.${portName(edge.target_node_id, edge.target_port_id)}`).sort(),
    // Which inputs a node will not run without, once they are wired: step 1's "needed".
    needed: graph.nodes.flatMap((node) => node.inputs.filter((port) => port.required).map((port) => `${node.node_type}.${port.id}`)).sort(),
    // How each node that authors a body takes a list: what "Run once per item" sets, as a run reads it.
    lists: graph.nodes.filter((node) => node.node_type === 'code' || node.node_type === 'ai')
      .map((node) => `${node.node_type} ${registry.node(node.node_type)!.batchMode(node as never)}: ${node.inputs.filter((port) => port.multi).map((port) => port.id).join(', ') || 'none fan out'}`).sort(),
  };
}

const FILES: Record<string, string> = {
  'data/population.csv': 'Country,Population\nChina,1419\nIndia,1450\nIndonesia,283',
  'stories/a.txt': 'The Lighthouse. A keeper counts ships for thirty-one years.',
  'stories/b.txt': 'The Map. A cartographer leaves one valley blank on purpose.',
};

/** The engine, with a disk of three files, bodies run in this process, and a model that says what it was asked. */
function runtime(asked: string[]): Runtime {
  return {
    files: {
      resolve: (path) => path, exists: async (path) => path in FILES,
      read: async (path) => { if (!(path in FILES)) throw new Error(`no such file: ${path}`); return FILES[path]; },
      write: async () => {}, list: async (path) => Object.keys(FILES).filter((file) => file.startsWith(`${path}/`)).sort(),
    },
    code: { run: async (body, inputs) => new Function('inputs', `${body}; return run(inputs);`)(inputs) as Record<string, unknown> },
    ai: { complete: async (request) => { asked.push(request.prompt); return `answer ${asked.length}`; } },
  };
}

async function run(graph: Graph, trigger: { node_id: string; port_id: string }, asked: string[] = []) {
  // A copy: the store's graph is frozen, and a run settles what it remembers into the graph it is given.
  const result = await executeGraph(parseGraph(JSON.parse(JSON.stringify(graph))), { runtime: runtime(asked), registry, trigger });
  const page = graph.nodes.find((node) => node.node_type === 'gui')!;
  return { result, asked, shown: (result.node_results.find((node) => node.node_id === page.id)?.display ?? {}) as Record<string, unknown> };
}

beforeEach(() => {
  store().loadGraph({
    metadata: { name: 'Built by hand', description: '', gui_scheme: 'night' },
    nodes: [], edges: [],
  });
});

describe('population plotter: choose a CSV, see the chart', () => {
  const build = () => {
    addBlock('text', 'heading', { value: 'Population plotter' });
    const page = pageId();
    const file = addBlock('input_picker', 'file', { label: 'CSV file', extensions: '.csv', value: 'data/population.csv', run_on_change: true });
    const plot = addBlock('plot_window', undefined, { label: '' });
    const chart = drop('code', 560);
    edit(chart, { label: 'What to plot', input: ['csv'], output: 'figure', config: { code: bodyOf('population_plotter', 'chart') }, perItem: false });
    wire(page, `${file}_out`, chart, 'csv');
    wire(chart, 'figure', page, `${plot}_in`);
    return { graph: store().rootGraph(), page, file, plot };
  };

  it('can be built by hand, is sound, and is the example', () => {
    const { graph } = build();
    expect(problemsIn(parseGraph(graph))).toEqual([]);
    expect(shapeOf(graph)).toEqual(shapeOf(example('population_plotter')));
  });

  it('draws the file that is chosen: the code is handed the file\'s text, because the wire came from a picker', async () => {
    const { graph, page, file, plot } = build();
    const { result, shown } = await run(graph, { node_id: page, port_id: `${file}_out` });
    expect(result.status).toBe('success');
    expect(shown[plot]).toMatchObject({ kind: 'bars', title: 'Population by Country', points: [{ label: 'India', value: 1450 }, { label: 'China', value: 1419 }, { label: 'Indonesia', value: 283 }] });
  });
});

describe('summarize a folder: choose a folder, read the summaries', () => {
  const build = () => {
    addBlock('text', 'heading', { value: 'Summarize a folder' });
    const page = pageId();
    const folder = addBlock('input_picker', 'directory', { label: 'Folder', extensions: '.txt', value: 'stories', run_on_change: true });
    const summaries = addBlock('text_io', 'output', { label: 'Summaries' });
    const summarize = drop('ai', 560);
    edit(summarize, { label: 'Each file', input: ['story'], config: { system_prompt: 'Summarize the story in two sentences.', prompt_template: '{{story}}' }, perItem: true });
    wire(page, `${folder}_out`, summarize, 'story');
    wire(summarize, 'output', page, `${summaries}_in`);
    return { graph: store().rootGraph(), page, folder, summaries };
  };

  it('can be built by hand, is sound, and is the example', () => {
    const { graph } = build();
    expect(problemsIn(parseGraph(graph))).toEqual([]);
    expect(shapeOf(graph)).toEqual(shapeOf(example('folder_summaries')));
  });

  it('asks once per file, with the file\'s text, and shows every summary in the one window', async () => {
    const { graph, page, folder, summaries } = build();
    const { result, asked, shown } = await run(graph, { node_id: page, port_id: `${folder}_out` });
    expect(result.status).toBe('success');
    expect(asked).toEqual([FILES['stories/a.txt'], FILES['stories/b.txt']]);
    expect(shown[summaries]).toEqual(['answer 1', 'answer 2']);
  });
});

describe('chat: a page with a chat block, and a model', () => {
  const build = () => {
    addBlock('text', 'heading', { value: 'Chat' });
    const page = pageId();
    const chat = addBlock('chat', undefined, {});
    const assistant = drop('ai', 560);
    edit(assistant, { label: 'Assistant', input: ['history', 'message'], config: { system_prompt: 'You are a friendly assistant.', prompt_template: 'Conversation so far:\n{{history}}\n\nUser: {{message}}' }, perItem: false, needed: ['message'] });
    wire(page, `${chat}_out`, assistant, 'message');
    wire(page, `${chat}_history`, assistant, 'history');
    wire(assistant, 'output', page, `${chat}_in`);
    return { graph: store().rootGraph(), page, chat };
  };

  it('can be built by hand, is sound, and is the example', () => {
    const { graph } = build();
    expect(problemsIn(parseGraph(graph))).toEqual([]);
    expect(shapeOf(graph)).toEqual(shapeOf(example('chat')));
  });

  it('answers a message, and remembers the turn for the next one', async () => {
    const { page, chat } = build();
    const asked: string[] = [];
    const say = async (text: string) => {
      const block = nodeOf(page).config.gui_widgets!.find((widget: GuiWidget) => widget.id === chat)!;
      patchBlock(chat, { value: { ...(block.value as object), pending: text } });
      const { result } = await run(store().rootGraph(), { node_id: page, port_id: `${chat}_out` }, asked);
      expect(result.status).toBe('success');
      // What the run remembered is replayed into the editor's copy, as after any run.
      store().setExecutionResult(result as never);
    };
    await say('Hello there');
    await say('And again');
    expect(asked[0]).toBe('Conversation so far:\n\n\nUser: Hello there');
    expect(asked[1]).toContain('User: Hello there');
    expect(asked[1]).toContain('Assistant: answer 1');
    expect(asked[1].endsWith('User: And again')).toBe(true);
  });
});

describe('a wire from a picker', () => {
  it('makes the input it ends on one that receives file paths, so nobody has to say it twice', () => {
    const file = addBlock('input_picker', 'file', { label: 'File' });
    const page = pageId();
    const code = drop('code', 560);
    expect(nodeOf(code).inputs[0].data_type).toBe('any');
    wire(page, `${file}_out`, code, nodeOf(code).inputs[0].id);
    expect(nodeOf(code).inputs[0].data_type).toBe('file_path');
    // The same wire twice is one wire.
    wire(page, `${file}_out`, code, nodeOf(code).inputs[0].id);
    expect(store().rfEdges).toHaveLength(1);
  });

  /**
   * Every kind a person wires a file into starts out saying nothing about what
   * it carries, and that is what lets the wire tick "Read the file at this
   * path" on it -- which is all the run asks (`execution/fileInputs.ts`). An AI
   * node was created `text` instead, so it alone was handed the file's *name*.
   */
  it.each(['code', 'ai'] as const)('%s: a new node says nothing about what its input carries, so a file reaches it whole', (kind) => {
    const file = addBlock('input_picker', 'file', { label: 'File' });
    const page = pageId();
    const node = drop(kind, 560);
    expect(nodeOf(node).inputs[0].data_type).toBe('any');
    wire(page, `${file}_out`, node, nodeOf(node).inputs[0].id);
    expect(readFilePorts(nodeOf(node))).toEqual([nodeOf(node).inputs[0].id]);
  });
});
