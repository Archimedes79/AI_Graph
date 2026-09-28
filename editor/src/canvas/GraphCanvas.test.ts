// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from 'reactflow';
import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { NODE_KINDS } from '@/document/nodeKinds';
import GraphCanvas from './GraphCanvas';

/**
 * The canvas in a page, used with a mouse and a keyboard: what a click, a
 * drag and a key do to the graph and to its undo steps -- ReactFlow's events
 * as they arrive, not the store's actions called by hand.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = () => useGraphStore.getState();
const node = (id: string) => store().rfNodes.find((item) => item.id === id)?.data.graphNode as GraphNode | undefined;
let root: Root;
let page: HTMLElement;

beforeEach(async () => {
  store().loadGraph({
    metadata: { name: 'Canvas', description: '', gui_scheme: 'night' },
    nodes: [{ ...NODE_KINDS.code.create('count'), label: 'Count' }, NODE_KINDS.output.create('shown')],
    edges: [{ id: 'e', source_node_id: 'count', source_port_id: 'output', target_node_id: 'shown', target_port_id: 'value' }],
  });
  page = document.createElement('div');
  document.body.appendChild(page);
  root = createRoot(page);
  await act(async () => {
    root.render(createElement(ReactFlowProvider, null, createElement(GraphCanvas, { active: true, onOpenPage: () => {} })));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  page.remove();
});

/** The card of node *id*, as ReactFlow draws it. */
const card = (id: string): HTMLElement => page.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;

/**
 * A mouse event of *type* on *target*, at *x*, *y* on the screen. Handled at
 * once: a canvas of no size, as it is here, pans by itself on every frame of
 * a drag, and a wait for React to settle would wait for that.
 */
function mouse(target: EventTarget, type: string, x = 10, y = 10): void {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y }));
  });
}

/** What the store is asked by hand, as a panel or a menu would ask it. */
const done = (change: () => void) => act(() => { change(); });

describe('a node on the canvas', () => {
  it('is chosen by a click, which changes nothing: Redo is still there, and Undo takes back the step before', async () => {
    done(() => store().updateNode('count', { label: 'Counted' }));
    done(() => store().undo());
    mouse(card('count'), 'mousedown');
    mouse(card('count'), 'mouseup');
    mouse(card('count'), 'click');
    // Chosen: its panel opens.
    expect(store().editingNodeId).toBe('count');
    // And nothing else: the click used to be a drag begun, an undo step that threw Redo away.
    expect(store().past).toHaveLength(0);
    done(() => store().redo());
    expect(node('count')!.label).toBe('Counted');
  });

  it('moved, is one undo step', async () => {
    const at = store().rfNodes.find((item) => item.id === 'count')!.position;
    mouse(card('count'), 'mousedown', 10, 10);
    for (const x of [20, 40, 60]) mouse(window, 'mousemove', x, 10);
    mouse(window, 'mouseup', 60, 10);
    expect(store().rfNodes.find((item) => item.id === 'count')!.position.x).toBeGreaterThan(at.x);
    expect(store().past).toHaveLength(1);
    done(() => store().undo());
    expect(store().rfNodes.find((item) => item.id === 'count')!.position).toEqual(at);
  });
});
