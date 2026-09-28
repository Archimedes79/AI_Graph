import { beforeEach, describe, it, expect } from 'vitest';
import { askToDelete, deletes, removalQuestion } from './nodeRemoval';
import type { GraphNode } from '@/graph';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import { NODE_KINDS } from '@/document/nodeKinds';
import { syncGuiNodePorts } from '@/document/guiWidgets';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { useGraphStore } from '@/store/graphStore';

function page(id: string, blocks: number): GraphNode {
  return {
    id, node_type: 'gui', label: `Node ${id}`, description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [],
    config: {
      ...baseNodeConfig(),
      gui_widgets: Array.from({ length: blocks }, (_, at) => WIDGET_BUILDERS.text.create(`block_${at + 1}`, 'Block')),
    },
  };
}

const counter = { ...NODE_KINDS.code.create('count'), label: 'Count' };

describe('what deleting asks first', () => {
  it('asks before a keystroke takes the whole page', () => {
    expect(removalQuestion([page('a', 3)], 0)).toBe('Delete the page? Its 3 blocks go with it.');
    expect(removalQuestion([page('a', 1)], 0)).toBe('Delete the page? Its 1 block goes with it.');
  });

  it('asks before a node\'s wires go with it -- one question, for its blocks and its wires alike', () => {
    expect(removalQuestion([counter], 1)).toBe('Delete "Count"? Its 1 connection goes with it.');
    expect(removalQuestion([page('a', 2)], 3)).toBe('Delete the page? Its 2 blocks and 3 connections go with it.');
    expect(removalQuestion([counter, page('a', 2)], 1)).toBe('Delete 2 nodes? Their 2 blocks and 1 connection go with them.');
  });

  it('does not ask about a node with nothing on it and nothing wired', () => {
    // A confirmation for that is the kind people learn to click past, which is
    // how a confirmation stops protecting anything.
    expect(removalQuestion([page('a', 0)], 0)).toBeNull();
    expect(removalQuestion([counter], 0)).toBeNull();
  });
});

describe('deleting', () => {
  const store = () => useGraphStore.getState();
  beforeEach(() => {
    const shown = WIDGET_BUILDERS.text_io.create('answer', 'Answer', 'output');
    store().loadGraph({
      metadata: { name: 'Delete', description: '', gui_scheme: 'night' },
      nodes: [counter, syncGuiNodePorts({ ...NODE_KINDS.gui.create('page'), config: { ...baseNodeConfig(), gui_widgets: [shown] } })],
      edges: [{ id: 'e', source_node_id: 'count', source_port_id: 'output', target_node_id: 'page', target_port_id: 'answer_in' }],
    });
  });

  it('leaves the page and its wires, all of them, when the answer is no', () => {
    // ReactFlow took the wires first and asked about the node after: the page
    // stayed, and every wire into it was gone.
    let asked = '';
    askToDelete(['page'], [], (question) => { asked = question; return false; });
    expect(asked).toBe('Delete the page? Its 1 block and 1 connection go with it.');
    expect(store().rfNodes.map((node) => node.id)).toEqual(['count', 'page']);
    expect(store().rfEdges).toHaveLength(1);
    expect(store().past).toHaveLength(0);
  });

  it('takes a node and its wires as one undo step', () => {
    // It was two: the wires, then the node.
    askToDelete(['count'], [], () => true);
    expect(store().rfNodes.map((node) => node.id)).toEqual(['page']);
    expect(store().rfEdges).toHaveLength(0);
    store().undo();
    expect(store().rfNodes.map((node) => node.id)).toEqual(['count', 'page']);
    expect(store().rfEdges).toHaveLength(1);
    expect(store().past).toHaveLength(0);
  });

  it('takes a wire selected on its own without a word', () => {
    askToDelete([], ['e'], () => { throw new Error('asked'); });
    expect(store().rfEdges).toHaveLength(0);
    expect(store().rfNodes).toHaveLength(2);
  });
});

describe('the keys that delete on the canvas', () => {
  it('are Delete and Backspace, while the canvas is the view on screen', () => {
    expect(deletes('Delete', true)).toBe(true);
    expect(deletes('Backspace', true)).toBe(true);
    expect(deletes('a', true)).toBe(false);
    // Another view on screen: the canvas stays mounted behind it, and its keys are not the view's.
    expect(deletes('Delete', false)).toBe(false);
  });
});
