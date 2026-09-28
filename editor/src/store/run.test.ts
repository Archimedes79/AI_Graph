import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionResult, GraphNode, GuiWidget } from '@/graph';
import { syncGuiNodePorts } from '@/document/guiWidgets';

// The server, as far as a run goes: each run waits until the test ends it, so
// the test can do what a person does meanwhile.
const runs: { finish: (result: ExecutionResult) => void }[] = [];
const started = vi.hoisted(() => ({ count: 0, sent: undefined as unknown }));
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body?: unknown) => {
    if (route === 'startRun') {
      started.count += 1;
      started.sent = body;
      return { run_id: `r${started.count}`, total: 1 };
    }
    if (route === 'run') {
      const result = await new Promise<ExecutionResult>((resolve) => { runs.push({ finish: resolve }); });
      return {
        run_id: 'r', done: true, cancelled: false, completed: 1, total: 1, current_label: '',
        item_done: 0, item_total: 0, idle_seconds: null, error: null, result,
      };
    }
    throw new Error(`not expected here: ${route}`);
  }),
}));

const { useGraphStore } = await import('./graphStore');
const store = () => useGraphStore.getState();
const nodeOf = (id: string) => store().rfNodes.find((n) => n.id === id)!.data.graphNode as GraphNode;
/** Until the run in flight has asked for its result. */
const polled = async (n = 1) => { while (runs.length < n) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  runs.length = 0;
  started.count = 0;
  store().newGraph();
});

describe('what a run is sent', () => {
  it('is what runs: a node\'s history, up to half a megabyte, stays in the editor', async () => {
    store().addNode('code', { x: 0, y: 0 });
    const graph = store().exportGraph();
    (graph.nodes[0].config as Record<string, unknown>).history = '## 2026-09-28 09:00 · ✨ Code\n\nNothing was sent.';
    const running = store().runGraph(graph);
    await polled();
    runs[0].finish({ status: 'success', outputs: {}, node_results: [] });
    await running;
    const sent = started.sent as { nodes: { config: Record<string, unknown> }[] };
    expect(sent.nodes[0].config).not.toHaveProperty('history');
    expect(sent.nodes[0].config.batch_mode).toBe('per_item');
  });
});

describe('a run that ends after another graph was opened', () => {
  it('writes nothing into the graph open now, whose node shares the id (B30)', async () => {
    store().addNode('code', { x: 0, y: 0 });
    const running = store().runGraph(store().exportGraph());
    await polled();

    // While it runs: another graph, whose code node is called "code" too.
    store().loadGraph({
      metadata: store().metadata,
      nodes: [{ id: 'code', node_type: 'code', label: 'B', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: { code: 'function run() { return { output: 1 }; }' } } as never],
      edges: [],
    });

    runs[0].finish({
      status: 'success', outputs: {},
      node_results: [{ node_id: 'code', status: 'success', outputs: { output: { rows: [1, 2] } }, inputs: {} }],
    });
    await running;

    expect(nodeOf('code').config.code).toBe('function run() { return { output: 1 }; }');
    expect(store().isDirty()).toBe(false);
    expect(store().executionResult).toBeNull();
    expect(store().isExecuting).toBe(false);
  });

  it('still shows what it made in the graph it started on', async () => {
    store().addNode('code', { x: 0, y: 0 });
    const running = store().runGraph(store().exportGraph());
    await polled();
    runs[0].finish({
      status: 'success', outputs: {},
      node_results: [{ node_id: 'code', status: 'success', outputs: { output: 3 }, inputs: {} }],
    });
    await running;
    expect(store().executionResult?.status).toBe('success');
    expect(store().executionResult?.node_results[0].outputs).toEqual({ output: 3 });
  });
});

describe('two presses of Run', () => {
  it('start one run, and Stop stays while it goes (B35)', async () => {
    store().addNode('code', { x: 0, y: 0 });
    const graph = store().exportGraph();
    const first = store().runGraph(graph);
    const second = store().runGraph(graph);
    await polled();
    await second;
    expect(started.count).toBe(1);
    expect(store().isExecuting).toBe(true);
    expect(store().currentRunId).toBe('r1');
    runs[0].finish({ status: 'success', outputs: {}, node_results: [] });
    await first;
    expect(store().isExecuting).toBe(false);
  });
});

describe('a box that sends, typed into while its message is on its way', () => {
  it('keeps what was typed since, and empties only what was sent (B34)', async () => {
    const page = store().addNode('gui', { x: 0, y: 0 });
    const box: GuiWidget = { id: 'say', kind: 'text_io', label: 'Say', tone: 'plain', mode: 'input', run_on_change: true, value: 'first' };
    store().updateNode(page, syncGuiNodePorts({ ...nodeOf(page), config: { ...nodeOf(page).config, gui_widgets: [box] } }));
    const running = store().runGraph(store().exportGraph(), { node_id: page, port_id: 'say_out' });
    await polled();

    const typed = (value: string) => store().updateNode(page, {
      config: { ...nodeOf(page).config, gui_widgets: nodeOf(page).config.gui_widgets.map((w) => ({ ...w, value })) },
    });
    typed('second');
    runs[0].finish({ status: 'success', outputs: {}, node_results: [{ node_id: page, status: 'success', outputs: {}, inputs: {} }] });
    await running;
    expect(nodeOf(page).config.gui_widgets[0].value).toBe('second');

    // Sent and not touched since: emptied, ready for the next message.
    const again = store().runGraph(store().exportGraph(), { node_id: page, port_id: 'say_out' });
    await polled(2);
    runs[1].finish({ status: 'success', outputs: {}, node_results: [{ node_id: page, status: 'success', outputs: {}, inputs: {} }] });
    await again;
    expect(nodeOf(page).config.gui_widgets[0].value).toBe('');
  });
});
