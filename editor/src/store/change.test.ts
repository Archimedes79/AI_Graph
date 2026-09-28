import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '@/graph';
import { useGraphStore } from './graphStore';
import { NODE_KINDS } from '@/document/nodeKinds';
import { nodePanel } from '@/canvas/nodePanel';

// What the bar under the canvas and the panel beside it ask of the store: a
// change said for one node, waiting for its panel; nothing selected any more;
// and a graph changed as a whole, taken as one step of the same document.

const store = () => useGraphStore.getState();
const stored = (id: string) => store().rfNodes.find((item) => item.id === id)?.data.graphNode as GraphNode | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  store().loadGraph({
    metadata: { name: 'Words', description: '', gui_scheme: 'night' },
    nodes: [{ ...NODE_KINDS.code.create('count'), label: 'Count' }, NODE_KINDS.output.create('shown'), NODE_KINDS.subgraph.create('part')],
    edges: [{ id: 'e', source_node_id: 'count', source_port_id: 'output', target_node_id: 'shown', target_port_id: 'value' }],
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('a change said for one node', () => {
  it('waits for that node\'s panel, with when it was said: the same words twice are two changes', () => {
    store().askChange('count', 'Count lines instead.');
    const first = store().pendingChange;
    expect(first).toMatchObject({ nodeId: 'count', text: 'Count lines instead.' });
    vi.advanceTimersByTime(5);
    store().askChange('count', 'Count lines instead.');
    expect(store().pendingChange!.at).toBeGreaterThan(first!.at);
    store().clearChange();
    expect(store().pendingChange).toBeNull();
  });

  it('is gone with the graph it was said in: another document, or a level in or out, may have a node of that id', () => {
    store().askChange('count', 'Count lines instead.');
    store().openSubgraph('part');
    expect(store().pendingChange).toBeNull();
    store().askChange('count', 'Meant for the node in here.');
    store().closeSubgraph();
    expect(store().pendingChange).toBeNull();
    store().askChange('count', 'Count lines instead.');
    store().loadGraph({ metadata: { name: 'Other', description: '', gui_scheme: 'night' }, nodes: [NODE_KINDS.code.create('count')], edges: [] });
    expect(store().pendingChange).toBeNull();
  });
});

describe('clearing the selection', () => {
  it('closes the panel and unmarks every node and wire on the canvas', () => {
    store().setEditingNode('count');
    store().setRFNodes(store().rfNodes.map((node) => ({ ...node, selected: node.id === 'count' })));
    store().setRFEdges(store().rfEdges.map((edge) => ({ ...edge, selected: true })));
    store().clearSelection();
    expect(store().editingNodeId).toBeNull();
    expect(store().rfNodes.some((node) => node.selected)).toBe(false);
    expect(store().rfEdges.some((edge) => edge.selected)).toBe(false);
  });

  it('writes what the panel still held, as closing it always did', () => {
    store().setEditingNode('count');
    const panel = nodePanel('count');
    const stop = panel.watch(() => {});
    panel.setConfig('code', 'function run() {}');
    store().clearSelection();
    expect(stored('count')!.config.code).toBe('function run() {}');
    stop();
  });

  it('changes nothing about the graph: it is not a step to undo', () => {
    const before = store().past.length;
    store().setEditingNode('count');
    store().clearSelection();
    expect(store().past).toHaveLength(before);
    expect(store().isDirty()).toBe(false);
  });
});

describe('the panel beside the canvas', () => {
  it('shows another node when another is chosen, and what the first still held is written first', () => {
    store().setEditingNode('count');
    const panel = nodePanel('count');
    const stop = panel.watch(() => {});
    panel.setConfig('code', 'function run() {}');
    store().setEditingNode('shown');
    expect(stored('count')!.config.code).toBe('function run() {}');
    expect(store().editingNodeId).toBe('shown');
    stop();
  });

  it('closes with its node, however the node goes -- left pointing at the id, it opened again on the next node of that id', () => {
    store().setEditingNode('count');
    store().deleteNode('count');
    expect(store().editingNodeId).toBeNull();
    store().setEditingNode('shown');
    // As the canvas removes a node: Delete pressed on it.
    store().setRFNodes(store().rfNodes.filter((node) => node.id !== 'shown'));
    expect(store().editingNodeId).toBeNull();
    // Moving what is left keeps a panel that is open.
    store().setEditingNode('part');
    store().setRFNodes(store().rfNodes.map((node) => ({ ...node, position: { x: 10, y: 10 } })));
    expect(store().editingNodeId).toBe('part');
  });
});

describe('a graph changed as said', () => {
  const changed = () => {
    const graph = store().exportGraph();
    return {
      ...graph,
      nodes: [...graph.nodes.map((node) => (node.id === 'count' ? { ...node, label: 'Count words' } : node)), NODE_KINDS.output.create('more')],
    };
  };

  it('is one undo step of the same document: the file it came from stays, and Undo takes the whole change back', () => {
    store().setCurrentFilePath('/work/words', true);
    const document = store().document;
    store().changeGraph(changed());
    expect(stored('count')!.label).toBe('Count words');
    expect(stored('more')).toBeDefined();
    expect(store().rfEdges).toHaveLength(1);
    expect(store().currentFilePath).toBe('/work/words');
    expect(store().document).toBe(document);
    expect(store().isDirty()).toBe(true);
    store().undo();
    expect(stored('count')!.label).toBe('Count');
    expect(stored('more')).toBeUndefined();
    expect(store().isDirty()).toBe(false);
  });

  it('leaves a node\'s panel open while its node is there, and closes it when the change took the node away', () => {
    store().setEditingNode('count');
    store().changeGraph(changed());
    expect(store().editingNodeId).toBe('count');
    const graph = store().exportGraph();
    store().changeGraph({ ...graph, nodes: graph.nodes.filter((node) => node.id !== 'count') });
    expect(store().editingNodeId).toBeNull();
  });
});
