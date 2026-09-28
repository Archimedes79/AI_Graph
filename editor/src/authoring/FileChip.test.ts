// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * A node's file chip opens that node's file: the one of the graph open now,
 * which may be the graph a node holds -- where ids are that graph's own.
 */

// The server: a save, and what opening a file was asked.
const asked = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body: Record<string, unknown>) => {
    if (route === 'saveGraph') return { path: '/work/tool', project: true };
    if (route !== 'openExternal') throw new Error(`not expected here: ${route}`);
    asked.push(body);
    return { path: '/work/tool/nodes/part/nodes/count/code.js', with: 'VS Code' };
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useGraphStore } = await import('@/store/graphStore');
const { NODE_KINDS } = await import('@/document/nodeKinds');
const { default: FileChip } = await import('./FileChip');

const store = () => useGraphStore.getState();

afterEach(() => { asked.length = 0; });

describe('a node\'s file chip', () => {
  it('names the graph the node is in: inside a node, the node\'s own, not the outer node of its id', async () => {
    const inner = { metadata: { name: 'Inner', description: '', gui_scheme: 'night' }, nodes: [NODE_KINDS.code.create('count')], edges: [] };
    store().loadGraph({
      metadata: { name: 'Outer', description: '', gui_scheme: 'night' },
      nodes: [NODE_KINDS.code.create('count'), { ...NODE_KINDS.subgraph.create('part'), config: { ...NODE_KINDS.subgraph.create('part').config, subgraph: inner as never } }],
      edges: [],
    });
    store().setCurrentFilePath('/work/tool', true);
    store().openSubgraph('part');

    const page = document.createElement('div');
    document.body.appendChild(page);
    const root = createRoot(page);
    await act(async () => { root.render(createElement(FileChip, { nodeId: 'count', file: 'code.js', written: false })); });
    await act(async () => { page.querySelector<HTMLButtonElement>('[aria-label="Open code.js"]')!.click(); });
    for (let tries = 0; tries < 50 && !asked.length; tries += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    expect(asked).toEqual([{ graph_path: '/work/tool', inside: ['part'], node_id: 'count', file: 'code.js' }]);
    expect(page.textContent).toContain('Opened in VS Code.');

    await act(async () => { root.unmount(); });
    page.remove();
    store().closeSubgraphsTo(0);
  });
});
