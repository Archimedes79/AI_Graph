import { describe, it, expect, vi } from 'vitest';
import type { ExecutionResult, Graph } from '@/graph';

// What the nodes that feed it deliver, run now: answered here instead of by the engine.
let delivered: Record<string, unknown> = {};
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  call: vi.fn(async () => ({ inputs: delivered, error: null })),
}));

const { fromTheGraph } = await import('./fromTheGraph');

const graph = (): Graph => ({ metadata: {} as never, nodes: [], edges: [] });
const ran = (inputs: Record<string, unknown>) => ({ node_results: [{ node_id: 'page', inputs }] }) as unknown as ExecutionResult;

describe('⟳ From the graph', () => {
  it('takes what arrived at a node on the last run, all of it', async () => {
    const got = await fromTheGraph('page', ran({ a: 1, b: 2 }), graph);
    expect(got).toEqual({ values: { a: 1, b: 2 }, said: 'What arrived here on the last run.' });
  });

  it('runs what feeds a node when the last run did not reach it, and says when nothing does', async () => {
    delivered = { a: 1 };
    expect((await fromTheGraph('page', null, graph)).said).toBe('What the nodes that feed this one delivered, run just now.');
    delivered = {};
    await expect(fromTheGraph('page', null, graph)).rejects.toThrow('Nothing is wired into this yet');
  });
});
