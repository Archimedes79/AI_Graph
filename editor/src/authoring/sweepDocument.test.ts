import { describe, it, expect, vi } from 'vitest';
import type { GenerateResponse } from '@/api/client';
import type { GraphNode } from '@/graph';

// ✨'s server, as far as a sweep goes: each generation waits until the test
// lets it answer, so the test can open another graph meanwhile.
const answers: ((response: GenerateResponse) => void)[] = [];
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn((route: string) => {
    if (route !== 'generate') throw new Error(`not expected here: ${route}`);
    return new Promise((resolve) => { answers.push(resolve); });
  }),
}));

const { useGraphStore } = await import('@/store/graphStore');
const { sweepGraph, ANOTHER_GRAPH } = await import('./useGraphSweep');
const store = () => useGraphStore.getState();
const nodeOf = (id: string) => store().rfNodes.find((n) => n.id === id)!.data.graphNode as GraphNode;

describe('a ✨ sweep that ends after another graph was opened', () => {
  it('writes nothing into the graph open now, whose node shares the id, and says why (B30)', async () => {
    store().newGraph();
    const id = store().addNode('code', { x: 0, y: 0 });
    store().updateNode(id, { description: 'Count the words.' });

    const said: string[] = [];
    const sweeping = sweepGraph({ say: (message) => said.push(message), stopped: () => false });
    while (!answers.length) await new Promise((r) => setTimeout(r, 0));

    const theirs = 'function run(inputs) { return { output: "theirs" }; }';
    store().loadGraph({
      metadata: store().metadata,
      nodes: [{ id, node_type: 'code', label: 'B', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: { code: theirs } } as never],
      edges: [],
    });

    answers[0]({
      result: 'module.exports = { "input": "mine" };', calls: [], probe: { status: 'skipped', error: '', problems: [] },
    });
    await sweeping;

    expect(nodeOf(id).config.code).toBe(theirs);
    expect(nodeOf(id).config.input_definition).toBeUndefined();
    expect(store().isDirty()).toBe(false);
    expect(said[said.length - 1]).toContain(ANOTHER_GRAPH);
  });
});
