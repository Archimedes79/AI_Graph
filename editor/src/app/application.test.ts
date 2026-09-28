import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, GraphNode } from '@/graph';
import type { RunTrigger } from '@/api/client';
import { useGraphStore } from '@/store/graphStore';
import { startApplication, stopApplication, useApplication } from './application';

// What ▶ Run starts: the application, as whoever gets the tool runs it.

const node = (id: string, node_type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id, node_type, label: id, description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
} as unknown as GraphNode);
const graphOf = (...nodes: GraphNode[]): Graph => ({ metadata: { name: 'Tool', description: '', gui_scheme: 'night' }, nodes, edges: [] } as Graph);
const page = (...blocks: Record<string, unknown>[]) => node('page', 'gui', { gui_widgets: blocks });

/** The rounds started, each by the event it was started with -- null for "everything". */
let rounds: (RunTrigger | null)[];
const runWhole = async () => { rounds.push(null); };
const realRunGraph = useGraphStore.getState().runGraph;

/** The graph open in the editor, run by a store whose runs only say what they were started with. */
const open = (graph: Graph): Graph => {
  useGraphStore.getState().loadGraph(graph);
  useGraphStore.setState({ runGraph: async (_graph, trigger = null) => { rounds.push(trigger); } });
  return useGraphStore.getState().rootGraph();
};

beforeEach(() => { rounds = []; vi.useFakeTimers(); });
afterEach(() => {
  stopApplication();
  useGraphStore.setState({ runGraph: realRunGraph, isExecuting: false, subgraphStack: [] });
  vi.useRealTimers();
});

describe('the application ▶ Run starts', () => {
  it('with a page, opens it and waits: the graph runs when the page is used, not before', async () => {
    const graph = open(graphOf(page({ id: 'msg', kind: 'text_io', mode: 'input', value: 'hello' }, { id: 'go', kind: 'button' }), node('work', 'code')));
    await startApplication(graph, runWhole);
    expect(rounds).toEqual([]);
    expect(useApplication.getState().running).toBe(true);
  });

  it('without a page, runs whole once, as a program does -- and has then ended', async () => {
    const graph = open(graphOf(node('work', 'code'), node('shown', 'output')));
    await startApplication(graph, runWhole);
    expect(rounds).toEqual([null]);
    expect(useApplication.getState().running).toBe(false);
  });

  it('opens empty: what the last run showed is not what this one has done', async () => {
    const graph = open(graphOf(page({ id: 'go', kind: 'button' })));
    useGraphStore.setState({ executionResult: { status: 'success', node_results: [], outputs: {}, error: null } });
    await startApplication(graph, runWhole);
    expect(useGraphStore.getState().executionResult).toBeNull();
  });

  it('fires the trigger nodes set to fire at start, and keeps each clock until it is stopped', async () => {
    const graph = open(graphOf(node('start', 'trigger', {}), node('clock', 'trigger', { trigger_on_start: false, trigger_every: '30s' }), node('work', 'code')));
    await startApplication(graph, runWhole);
    expect(rounds).toEqual([{ node_id: 'start', port_id: 'fired' }]);
    expect(useApplication.getState().running).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(rounds.slice(1)).toEqual([{ node_id: 'clock', port_id: 'fired' }, { node_id: 'clock', port_id: 'fired' }]);
    stopApplication();
    expect(useApplication.getState().running).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(rounds).toHaveLength(3);
  });

  it('ends by itself where nothing is left to happen: no page, and no clock that can be read', async () => {
    await startApplication(open(graphOf(node('start', 'trigger', {}), node('work', 'code'))), runWhole);
    expect(rounds).toEqual([{ node_id: 'start', port_id: 'fired' }]);
    expect(useApplication.getState().running).toBe(false);

    rounds = [];
    await startApplication(open(graphOf(node('start', 'trigger', { trigger_every: 'every so often' }))), runWhole);
    expect(rounds).toEqual([{ node_id: 'start', port_id: 'fired' }]);
    expect(useApplication.getState().running).toBe(false);
  });

  it('looks each trigger up when it is due: one deleted since fires no more', async () => {
    const graph = open(graphOf(node('clock', 'trigger', { trigger_on_start: false, trigger_every: '10s' }), node('work', 'code')));
    await startApplication(graph, runWhole);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rounds).toHaveLength(1);
    useGraphStore.getState().deleteNode('clock');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rounds).toHaveLength(1);
  });

  it('waits with a round while another is going, or while the canvas shows a node\'s graph', async () => {
    const graph = open(graphOf(node('clock', 'trigger', { trigger_on_start: false, trigger_every: '10s' })));
    await startApplication(graph, runWhole);
    useGraphStore.setState({ isExecuting: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rounds).toEqual([]);
    useGraphStore.setState({ isExecuting: false, subgraphStack: [{ nodeId: 'part', graph, past: [], future: [] }] as never });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(rounds).toEqual([]);
    useGraphStore.setState({ subgraphStack: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(rounds).toEqual([{ node_id: 'clock', port_id: 'fired' }]);
  });

  it('starts anew without the clock of the start before: a round of that one never comes back', async () => {
    const graph = open(graphOf(node('clock', 'trigger', { trigger_on_start: false, trigger_every: '10s' })));
    await startApplication(graph, runWhole);
    stopApplication();
    await startApplication(graph, runWhole);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rounds).toHaveLength(1);
  });
});
