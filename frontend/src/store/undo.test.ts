import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from './graphStore';
import type { Graph } from '../types/graph';

const emptyGraph: Graph = {
  metadata: {
    name: 'Undo test', version: '1.0.0', description: '', author: '', tags: [],
    ai_defaults: { provider: 'default', model: '' },
  gui_scheme: 'night',
  },
  nodes: [],
  edges: [],
};

const store = () => useGraphStore.getState();
const nodeCount = () => store().rfNodes.length;

describe('undo / redo', () => {
  beforeEach(() => {
    store().loadGraph(structuredClone(emptyGraph));
  });

  it('has nothing to undo on a freshly loaded graph', () => {
    expect(store().canUndo()).toBe(false);
    expect(store().canRedo()).toBe(false);
  });

  it('undoes and redoes adding a node', () => {
    store().addNode('code', { x: 0, y: 0 });
    expect(nodeCount()).toBe(1);

    store().undo();
    expect(nodeCount()).toBe(0);
    expect(store().canRedo()).toBe(true);

    store().redo();
    expect(nodeCount()).toBe(1);
  });

  it('restores a deleted node together with its edges', () => {
    store().addNode('code', { x: 0, y: 0 });
    store().addNode('output', { x: 200, y: 0 });
    const [source, target] = store().rfNodes.map((n) => n.id);

    store().commit();
    store().setRFEdges([{
      id: 'e1', source, target, sourceHandle: 'result', targetHandle: 'value',
    } as never]);
    expect(store().rfEdges).toHaveLength(1);

    // Deleting the source must take the edge with it...
    store().deleteNode(source);
    expect(nodeCount()).toBe(1);
    expect(store().rfEdges).toHaveLength(0);

    // ...and undoing must bring both back, or an undo silently loses wiring.
    store().undo();
    expect(nodeCount()).toBe(2);
    expect(store().rfEdges).toHaveLength(1);
  });

  it('steps back through several changes in order', () => {
    store().addNode('code', { x: 0, y: 0 });
    store().addNode('output', { x: 100, y: 0 });
    store().addNode('data', { x: 200, y: 0 });
    expect(nodeCount()).toBe(3);

    store().undo();
    expect(nodeCount()).toBe(2);
    store().undo();
    expect(nodeCount()).toBe(1);
    store().undo();
    expect(nodeCount()).toBe(0);
    expect(store().canUndo()).toBe(false);
  });

  it('a new change abandons the redo branch', () => {
    store().addNode('code', { x: 0, y: 0 });
    store().undo();
    expect(store().canRedo()).toBe(true);

    store().addNode('output', { x: 0, y: 0 });
    expect(store().canRedo()).toBe(false);
  });

  it('a delete that commits twice still costs only one undo', () => {
    store().addNode('code', { x: 0, y: 0 });
    const id = store().rfNodes[0].id;

    // One deletion can commit twice: the canvas sees a `remove` change and the
    // node's own delete button calls deleteNode. Both snapshot the same
    // pre-delete state, so they must collapse into a single history entry.
    store().commit();
    store().deleteNode(id);
    expect(nodeCount()).toBe(0);

    store().undo();
    expect(nodeCount()).toBe(1);
  });

  it('undoing back to the saved state reads as clean again', () => {
    store().addNode('code', { x: 0, y: 0 });
    store().markSaved();
    expect(store().isDirty()).toBe(false);

    store().addNode('output', { x: 0, y: 0 });
    expect(store().isDirty()).toBe(true);

    store().undo();
    expect(store().isDirty()).toBe(false);
  });

  it('undoes a node configuration change', () => {
    store().addNode('code', { x: 0, y: 0 });
    const id = store().rfNodes[0].id;
    const original = store().rfNodes[0].data.graphNode.label;

    store().updateNode(id, { label: 'Renamed' });
    expect(store().rfNodes[0].data.graphNode.label).toBe('Renamed');

    store().undo();
    expect(store().rfNodes[0].data.graphNode.label).toBe(original);
  });

  it('loading a different graph clears the history', () => {
    store().addNode('code', { x: 0, y: 0 });
    expect(store().canUndo()).toBe(true);

    store().loadGraph(structuredClone(emptyGraph));
    // Undoing into the previous document would restore nodes that no longer
    // belong to the graph now open.
    expect(store().canUndo()).toBe(false);
    expect(store().canRedo()).toBe(false);
  });

  it('keeps the history bounded', () => {
    for (let i = 0; i < 60; i += 1) store().addNode('code', { x: i, y: 0 });
    expect(store().past.length).toBeLessThanOrEqual(50);
  });

  it('moving nodes does not write history per frame', () => {
    store().addNode('code', { x: 0, y: 0 });
    const before = store().past.length;

    // ReactFlow reports a position change on every frame of a drag and routes
    // them through setRFNodes. If that committed, one drag across the canvas
    // would bury the real history under dozens of one-pixel steps -- the undo
    // point comes from onNodeDragStart instead.
    for (let x = 1; x <= 30; x += 1) {
      const moved = store().rfNodes.map((n) => ({ ...n, position: { x, y: 0 } }));
      store().setRFNodes(moved as never);
    }

    expect(store().past.length).toBe(before);
    expect(store().rfNodes[0].position.x).toBe(30);
  });
});
