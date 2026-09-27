import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { COALESCE_MS, useGraphStore } from './graphStore';
import type { Graph } from '@/graph';

const emptyGraph: Graph = {
  metadata: {
    name: 'Undo test', description: '',
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
    expect(store().past).toHaveLength(0);
    expect(store().future).toHaveLength(0);
  });

  it('undoes and redoes adding a node', () => {
    store().addNode('code', { x: 0, y: 0 });
    expect(nodeCount()).toBe(1);

    store().undo();
    expect(nodeCount()).toBe(0);
    expect(store().future.length).toBeGreaterThan(0);

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
    expect(store().past).toHaveLength(0);
  });

  it('a new change abandons the redo branch', () => {
    store().addNode('code', { x: 0, y: 0 });
    store().undo();
    expect(store().future.length).toBeGreaterThan(0);

    store().addNode('output', { x: 0, y: 0 });
    expect(store().future).toHaveLength(0);
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
    expect(store().past.length).toBeGreaterThan(0);

    store().loadGraph(structuredClone(emptyGraph));
    // Undoing into the previous document would restore nodes that no longer
    // belong to the graph now open.
    expect(store().past).toHaveLength(0);
    expect(store().future).toHaveLength(0);
  });

  it('keeps the history bounded', () => {
    for (let i = 0; i < 60; i += 1) store().addNode('code', { x: i, y: 0 });
    expect(store().past.length).toBeLessThanOrEqual(50);
  });

  describe('a change typed into one field', () => {
    // A dialog writes what is typed as it is typed, a moment later each time:
    // one undo step per keystroke was fifty steps for a sentence.
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    const label = () => store().rfNodes[0].data.graphNode.label;
    const typed = (text: string, key = 'code: label') => store().updateNode(store().rfNodes[0].id, { label: text }, undefined, key);

    it('is one undo step, however many writes it took', () => {
      store().addNode('code', { x: 0, y: 0 });
      const before = label();
      for (const text of ['W', 'Wo', 'Wor', 'Word']) { typed(text); vi.advanceTimersByTime(500); }
      expect(label()).toBe('Word');
      store().undo();
      expect(label()).toBe(before);
    });

    it('is a step of its own after a pause, or after a change to another field', () => {
      store().addNode('code', { x: 0, y: 0 });
      typed('One');
      vi.advanceTimersByTime(COALESCE_MS + 1);
      typed('Two');
      typed('Three', 'code: description');
      store().undo();
      expect(label()).toBe('Two');
      store().undo();
      expect(label()).toBe('One');
    });

    it('starts afresh after an undo: typing again is not added to the step undone', () => {
      store().addNode('code', { x: 0, y: 0 });
      typed('One');
      store().undo();
      typed('Two');
      expect(store().future).toHaveLength(0);
      store().undo();
      expect(store().rfNodes).toHaveLength(1);
    });
  });

  it('leaves the node\'s dialog open on an undo that keeps its node, and closes it on one that takes it away', () => {
    store().addNode('code', { x: 0, y: 0 });
    const id = store().rfNodes[0].id;
    store().updateNode(id, { label: 'Renamed' });
    store().setEditingNode(id);
    store().undo();
    expect(store().editingNodeId).toBe(id);
    store().undo();
    expect(store().rfNodes).toHaveLength(0);
    expect(store().editingNodeId).toBeNull();
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
