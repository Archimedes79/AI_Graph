import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, GraphNode } from '@/graph';

// What ▶ Run starts: the application, as whoever gets the tool runs it -- its
// clock kept by the server's session, the document handed to it first.

const server = vi.hoisted(() => ({ asked: [] as string[], ticks: false, slowStop: false }));
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, _request?: unknown, options?: { keepalive?: boolean }) => {
    server.asked.push(options?.keepalive ? `${route}, as the page closes` : route);
    if (route === 'holdGraph') return { session: 's1', dropped: [] };
    if (route === 'startApplication') return { ticks: server.ticks };
    if (route === 'stopApplication' && server.slowStop) {
      await new Promise((wake) => setTimeout(wake, 5));
      server.asked.push('stopApplication answered');
    }
    return { stopped: true };
  }),
}));
vi.mock('@/api/session', async (actual) => ({
  ...(await actual<typeof import('@/api/session')>()),
  watchSession: vi.fn(() => () => {}),
}));

// The window the editor runs in: who listens for what it says as it is closed or reloaded.
const listening = new Map<string, () => void>();
vi.stubGlobal('addEventListener', (type: string, listener: () => void) => { listening.set(type, listener); });
vi.stubGlobal('removeEventListener', (type: string, listener: () => void) => { if (listening.get(type) === listener) listening.delete(type); });

const { useGraphStore } = await import('@/store/graphStore');
const { startApplication, stopApplication, useApplication } = await import('./application');

const node = (id: string, node_type: string, config: Record<string, unknown> = {}): GraphNode => ({
  id, node_type, label: id, description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
} as unknown as GraphNode);
const graphOf = (...nodes: GraphNode[]): Graph => ({ metadata: { name: 'Tool', description: '', gui_scheme: 'night' }, nodes, edges: [] } as Graph);
const page = (...blocks: Record<string, unknown>[]) => node('page', 'gui', { gui_widgets: blocks });

/** The rounds ▶ Run itself started whole: what nothing else starts. */
let whole: number;
const runWhole = async () => { whole += 1; };

/** The graph open in the editor. */
const open = (graph: Graph): Graph => {
  useGraphStore.getState().loadGraph(graph);
  return useGraphStore.getState().rootGraph();
};

beforeEach(() => { whole = 0; server.asked.length = 0; server.ticks = false; server.slowStop = false; vi.useFakeTimers(); });
afterEach(async () => {
  await stopApplication();
  vi.useRealTimers();
});

describe('the application ▶ Run starts', () => {
  it('with a page, hands the document over, starts the server\'s clock and waits: the graph runs when the page is used', async () => {
    const graph = open(graphOf(page({ id: 'msg', kind: 'text_io', mode: 'input', value: 'hello' }, { id: 'go', kind: 'button' }), node('work', 'code')));
    await startApplication(graph, runWhole);
    expect(server.asked).toEqual(['holdGraph', 'startApplication']);
    expect(whole).toBe(0);
    expect(useApplication.getState().running).toBe(true);
  });

  it('is running from the moment it is started, before the server has answered: the App tab it opens stays open', async () => {
    const graph = open(graphOf(page({ id: 'go', kind: 'button' })));
    const starting = startApplication(graph, runWhole);
    expect(useApplication.getState().running).toBe(true);
    await starting;
  });

  it('stops the one before in the server before it starts there: a stop cannot overtake the start', async () => {
    vi.useRealTimers();
    const graph = open(graphOf(page({ id: 'go', kind: 'button' })));
    await startApplication(graph, runWhole);
    server.asked.length = 0;
    server.slowStop = true;
    await startApplication(graph, runWhole);
    expect(server.asked).toEqual(['stopApplication', 'stopApplication answered', 'holdGraph', 'startApplication']);
  });

  it('without a page, runs whole once, as a program does -- and has then ended', async () => {
    const graph = open(graphOf(node('work', 'code'), node('shown', 'output')));
    await startApplication(graph, runWhole);
    expect(whole).toBe(1);
    expect(useApplication.getState().running).toBe(false);
    expect(server.asked[server.asked.length - 1]).toBe('stopApplication');
  });

  it('starts with nothing shown on the graph: what the last run showed there is not what this one has done', async () => {
    const graph = open(graphOf(page({ id: 'go', kind: 'button' })));
    useGraphStore.setState({ executionResult: { status: 'success', node_results: [], outputs: {}, error: null } });
    await startApplication(graph, runWhole);
    expect(useGraphStore.getState().executionResult).toBeNull();
  });

  it('leaves its trigger nodes to the server\'s clock, and keeps running while one ticks', async () => {
    server.ticks = true;
    const graph = open(graphOf(node('clock', 'trigger', { trigger_on_start: false, trigger_every: '30s' }), node('work', 'code')));
    await startApplication(graph, runWhole);
    expect(whole).toBe(0);
    expect(useApplication.getState().running).toBe(true);
    await stopApplication();
    expect(useApplication.getState().running).toBe(false);
    expect(server.asked[server.asked.length - 1]).toBe('stopApplication');
  });

  it('ends by itself where nothing is left to happen: no page, and no clock that ticks', async () => {
    await startApplication(open(graphOf(node('start', 'trigger', {}), node('work', 'code'))), runWhole);
    expect(whole).toBe(0);
    expect(useApplication.getState().running).toBe(false);
  });

  it('ends with the editor: closed or reloaded while it runs, the server\'s clock is stopped', async () => {
    server.ticks = true;
    await startApplication(open(graphOf(node('clock', 'trigger', { trigger_on_start: false, trigger_every: '30s' }))), runWhole);
    server.asked.length = 0;
    listening.get('pagehide')!();
    expect(server.asked).toEqual(['stopApplication, as the page closes']);
    // Stopped by ■ Stop, it has nothing left to stop as the page closes.
    await stopApplication();
    expect(listening.has('pagehide')).toBe(false);
  });

  it('is the document that runs: an edit while it runs is handed over a moment after', async () => {
    const graph = open(graphOf(page({ id: 'go', kind: 'button' }), node('work', 'code')));
    await startApplication(graph, runWhole);
    server.asked.length = 0;
    useGraphStore.getState().addNode('code', { x: 100, y: 0 });
    useGraphStore.getState().addNode('code', { x: 200, y: 0 });
    expect(server.asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(server.asked).toEqual(['holdGraph']);
    // Stopped, it no longer is.
    await stopApplication();
    server.asked.length = 0;
    useGraphStore.getState().addNode('code', { x: 300, y: 0 });
    await vi.advanceTimersByTimeAsync(600);
    expect(server.asked).toEqual([]);
  });
});
