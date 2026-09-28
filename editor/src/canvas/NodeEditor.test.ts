// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGraphStore } from '@/store/graphStore';
import NodeEditor from './NodeEditor';

/**
 * A node's panel, drawn anew when what it shows changes -- its node, the
 * graph around it -- and not on every change of the store: a run in flight
 * changes it every 400 ms, a drag on every frame.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = () => useGraphStore.getState();
let root: Root;
let page: HTMLElement;
let drawn = 0;

beforeEach(async () => {
  store().newGraph();
  const nodeId = store().addNode('code', { x: 0, y: 0 });
  store().addNode('output', { x: 300, y: 0 });
  page = document.createElement('div');
  document.body.appendChild(page);
  root = createRoot(page);
  drawn = 0;
  await act(async () => {
    root.render(createElement(Profiler, { id: 'panel', onRender: () => { drawn += 1; } }, createElement(NodeEditor, { nodeId, onClose: () => {} })));
  });
  // Its panel is a chunk of its own, loaded when first drawn.
  for (let tries = 0; tries < 50 && !page.querySelector('[aria-label="What it should do"]'); tries += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  // And then drawn until it is still: a chunk that lands later -- a code box's
  // editor -- draws it once more, and on a slower machine that was counted as
  // a draw the store caused (CI: 3 where 2 were expected).
  for (let still = 0, last = -1, tries = 0; still < 3 && tries < 100; tries += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    still = drawn === last ? still + 1 : 0;
    last = drawn;
  }
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  page.remove();
  useGraphStore.setState({ runProgress: null });
});

describe('a node\'s panel', () => {
  it('is not drawn anew by a run\'s progress, nor by a node moved on the canvas', async () => {
    const before = drawn;
    for (let tick = 1; tick <= 3; tick += 1) {
      await act(async () => {
        useGraphStore.setState({ runProgress: { completed: tick, total: 5, label: 'Count', itemDone: 0, itemTotal: 0, idleSeconds: null } });
      });
    }
    await act(async () => {
      store().setRFNodes(store().rfNodes.map((node) => ({ ...node, position: { x: node.position.x + 5, y: node.position.y } })));
    });
    expect(drawn).toBe(before);
  });

  it('is drawn anew when another node of the graph changes: it says what that node hands it', async () => {
    const before = drawn;
    const other = store().rfNodes[1].id;
    await act(async () => { store().updateNode(other, { label: 'Shown' }); });
    expect(drawn).toBeGreaterThan(before);
  });

  it('says so of a node of a type this editor does not know, which it keeps as it came', async () => {
    const later = { id: 'later', node_type: 'vision', label: 'Later', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: {} };
    await act(async () => {
      store().loadGraph({ metadata: { name: 'Later', description: '', gui_scheme: 'night' }, nodes: [later as never], edges: [] });
    });
    await act(async () => { root.render(createElement(NodeEditor, { nodeId: 'later', onClose: () => {} })); });
    expect(page.textContent).toContain('This editor does not know nodes of type "vision". The node is kept, and saved, as it came.');
  });
});
