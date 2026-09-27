import { describe, it, expect, vi } from 'vitest';
import type { ExecutionResult, Graph, GuiWidget } from '@/graph';
import { WIDGET_BUILDERS } from '@/elements/registry';

// What the nodes that feed it deliver, run now: answered here instead of by the engine.
let delivered: Record<string, unknown> = {};
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  call: vi.fn(async () => ({ inputs: delivered, error: null })),
}));

const { fromTheGraph } = await import('./fromTheGraph');
const { blockFromTheGraph } = await import('./blockFacts');

const graph = (): Graph => ({ metadata: {} as never, nodes: [], edges: [] });
const ran = (inputs: Record<string, unknown>) => ({ node_results: [{ node_id: 'page', inputs }] }) as unknown as ExecutionResult;
const chart = { ...WIDGET_BUILDERS.table.create('Rows'), id: 'rows' } as GuiWidget;

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

  it('hands a block only what arrived on its own port, as its code is handed it', async () => {
    const got = await blockFromTheGraph('page', chart, ran({ rows_in: [1, 2], other_in: 'x' }), graph);
    expect(got).toEqual({ values: { value: [1, 2] }, said: 'What arrived here on the last run.' });
  });

  it('says nothing arrived at a block when only the other blocks of its page were fed', async () => {
    delivered = { other_in: 'x' };
    await expect(blockFromTheGraph('page', chart, ran({ other_in: 'x' }), graph))
      .rejects.toThrow('Nothing is wired into this block yet');
    delivered = { rows_in: [3] };
    expect(await blockFromTheGraph('page', chart, null, graph))
      .toEqual({ values: { value: [3] }, said: 'What the nodes that feed this block delivered, run just now.' });
  });
});
