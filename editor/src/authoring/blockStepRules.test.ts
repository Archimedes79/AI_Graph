import { describe, it, expect, vi } from 'vitest';
import type { GuiWidget } from '@/graph';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { useGraphStore } from '@/store/graphStore';

// What Try it would post, caught instead of posted.
const posted: { route: string; body: Record<string, unknown> }[] = [];
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body: Record<string, unknown>) => {
    posted.push({ route, body });
    return { status: 'success', shown: null, error: null };
  }),
}));

const { tryBlock } = await import('./blockStepRules');

describe('a block tried by itself', () => {
  it('is sent with the graph it belongs to: code that asks a model asks the graph\'s', async () => {
    // The bug: only the block and the value were sent, so Try it asked the
    // machine's default model while a run of the graph asked the graph's.
    useGraphStore.getState().loadGraph({
      metadata: { name: 'T', version: '1.0.0', description: '', author: '', tags: [], ai_defaults: { provider: 'anthropic', model: 'the-graphs-model' } },
      nodes: [], edges: [],
    } as never);
    const table = { ...WIDGET_BUILDERS.table.create('Rows'), id: 'rows' } as GuiWidget;
    await tryBlock(table, { value: [{ city: 'Oslo' }] });
    expect(posted[posted.length - 1]).toMatchObject({
      route: 'runBlock',
      body: { value: [{ city: 'Oslo' }], metadata: { ai_defaults: { provider: 'anthropic', model: 'the-graphs-model' } } },
    });
  });
});
