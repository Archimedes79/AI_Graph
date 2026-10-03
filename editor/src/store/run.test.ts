import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionResult } from '@/graph';
import type { RoundSnapshot } from '@/api/client';

// The server, as far as a document's session goes: what it was handed, and
// which session that is -- it goes on with the one a document is handed over
// as, and any other is a new one.
const server = vi.hoisted(() => ({ held: [] as unknown[], sessions: 0 }));
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body?: { session?: string | null }) => {
    if (route === 'holdGraph') {
      server.held.push(body);
      if (!body?.session || body.session !== `s${server.sessions}`) server.sessions += 1;
      return { session: `s${server.sessions}`, dropped: [] };
    }
    throw new Error(`not expected here: ${route}`);
  }),
}));
// Listening to a session is the stream's; here, rounds are told by hand.
vi.mock('@/api/session', async (actual) => ({
  ...(await actual<typeof import('@/api/session')>()),
  watchSession: vi.fn(() => () => {}),
}));

const { useGraphStore } = await import('./graphStore');
const store = () => useGraphStore.getState();

const round = (over: Partial<RoundSnapshot> = {}): RoundSnapshot => ({
  round_id: 'r1', done: true, cancelled: false, completed: 1, total: 1, current_label: '',
  item_done: 0, item_total: 0, idle_seconds: null, error: null, result: null, outputs: null, whole: false, ...over,
});
const made = (node_id: string, outputs: Record<string, unknown>): ExecutionResult => ({
  status: 'success', outputs: {}, node_results: [{ node_id, status: 'success', outputs, inputs: {} }],
});

beforeEach(() => {
  server.held.length = 0;
  server.sessions = 0;
  store().newGraph();
});

describe('what the server\'s session is handed', () => {
  it('is what runs: a node\'s history, up to half a megabyte, stays in the editor', async () => {
    const id = store().addNode('code', { x: 0, y: 0 });
    store().updateNode(id, { config: { ...store().rfNodes[0].data.graphNode.config, history: '## 2026-09-28 09:00 · ✨ Code\n\nNothing was sent.', batch_mode: 'per_item' } });
    await store().holdDocument();
    const sent = server.held[0] as { graph: { nodes: { config: Record<string, unknown> }[] } };
    expect(sent.graph.nodes[0].config).not.toHaveProperty('history');
    expect(sent.graph.nodes[0].config.batch_mode).toBe('per_item');
  });

  it('is a session of its own for another document, and the same one for the same document', async () => {
    await store().holdDocument();
    await store().holdDocument();
    store().newGraph();
    await store().holdDocument();
    expect(server.held.map((asked) => (asked as { session: string | null }).session)).toEqual([null, 's1', null]);
  });
});

describe('a round of the session', () => {
  it('is followed while it goes, and shows what it made once it has ended', async () => {
    store().addNode('code', { x: 0, y: 0 });
    await store().holdDocument();
    store().followRound(round({ done: false, completed: 0, total: 2, current_label: 'Count' }));
    expect(store().isExecuting).toBe(true);
    expect(store().runProgress).toMatchObject({ completed: 0, total: 2, label: 'Count' });
    store().followRound(round({ result: made('code', { output: 3 }) }));
    expect(store().isExecuting).toBe(false);
    expect(store().runProgress).toBeNull();
    expect(store().executionResult?.node_results[0].outputs).toEqual({ output: 3 });
  });

  it('that an event started is laid over what was shown; a whole one starts from a clean slate', async () => {
    await store().holdDocument();
    store().followRound(round({ result: made('a', { x: 1 }) }));
    store().followRound(round({ round_id: 'r2', result: made('b', { y: 2 }) }));
    expect(store().executionResult?.node_results.map((one) => one.node_id)).toEqual(['a', 'b']);
    store().followRound(round({ round_id: 'r3', whole: true, result: made('c', { z: 3 }) }));
    expect(store().executionResult?.node_results.map((one) => one.node_id)).toEqual(['c']);
  });

  it('that ends after another graph was opened writes nothing, and shows nothing, there (B30)', async () => {
    store().addNode('code', { x: 0, y: 0 });
    await store().holdDocument();
    store().followRound(round({ done: false }));
    // While it runs: another graph, whose code node is called "code" too.
    store().loadGraph({
      metadata: store().metadata,
      nodes: [{ id: 'code', node_type: 'code', label: 'B', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: { code: 'function run() { return { output: 1 }; }' } } as never],
      edges: [],
    });
    store().followRound(round({ result: made('code', { output: { rows: [1, 2] } }) }));
    expect(store().executionResult).toBeNull();
    expect(store().isDirty()).toBe(false);
  });

  it('that could not run is said as a failure, with its reason', async () => {
    await store().holdDocument();
    store().followRound(round({ error: 'Graph contains a cycle' }));
    expect(store().executionResult).toMatchObject({ status: 'error', error: 'Graph contains a cycle' });
  });
});
