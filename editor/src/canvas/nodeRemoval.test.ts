import { describe, it, expect } from 'vitest';
import type { NodeChange } from 'reactflow';
import { deleteKeys, removalsToApply } from './nodeRemoval';
import type { GraphNode } from '@/graph';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import { WIDGET_BUILDERS } from '@/elements/registry';

function node(id: string, blocks: number): GraphNode {
  return {
    id, node_type: 'gui', label: `Node ${id}`, description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [],
    config: {
      ...baseNodeConfig(),
      gui_widgets: Array.from({ length: blocks }, () => WIDGET_BUILDERS.text.create('Block')),
    },
  };
}

const remove = (id: string): NodeChange => ({ type: 'remove', id });

describe('removalsToApply', () => {
  it('asks before a keystroke takes the whole page', () => {
    let asked = '';
    const kept = removalsToApply([remove('a')], () => node('a', 3), (q) => { asked = q; return false; });
    expect(kept).toEqual([]);
    expect(asked).toBe('Delete the page? Its 3 blocks go with it.');
  });

  it('lets it through once the answer is yes', () => {
    const kept = removalsToApply([remove('a')], () => node('a', 3), () => true);
    expect(kept).toHaveLength(1);
  });

  it('does not ask about a node with nothing on its page', () => {
    // A confirmation for an empty node is the kind people learn to click past,
    // which is how a confirmation stops protecting anything.
    let asked = false;
    const kept = removalsToApply([remove('a')], () => node('a', 0), () => { asked = true; return true; });
    expect(kept).toHaveLength(1);
    expect(asked).toBe(false);
  });

  it('leaves everything that is not a removal alone', () => {
    const moves: NodeChange[] = [{ type: 'position', id: 'a', position: { x: 1, y: 2 } }];
    expect(removalsToApply(moves, () => node('a', 5), () => false)).toEqual(moves);
  });
});

describe('the keys that delete on the canvas', () => {
  it('delete nothing while a node\'s dialog is open over it -- Backspace deleted the node behind it', () => {
    expect(deleteKeys(true, false)).toEqual(['Delete', 'Backspace']);
    // A button that went away under the focus -- ✨ Fix, once it fixed -- leaves the key to the page.
    expect(deleteKeys(true, true)).toBeNull();
    // Another view on screen: the canvas stays mounted behind it, and its keys are not the view's.
    expect(deleteKeys(false, false)).toBeNull();
  });
});
