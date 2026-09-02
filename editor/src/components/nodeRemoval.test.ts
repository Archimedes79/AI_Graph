import { describe, it, expect } from 'vitest';
import type { NodeChange } from 'reactflow';
import { removalsToApply } from './nodeRemoval';
import type { GraphNode } from '../types/graph';
import { baseNodeConfig } from '../elements/shared/baseNodeConfig';
import { createGuiWidget } from '../utils/guiWidgets';

function node(id: string, blocks: number): GraphNode {
  return {
    id, node_type: 'gui', label: `Node ${id}`, description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [],
    config: {
      ...baseNodeConfig(),
      gui_widgets: Array.from({ length: blocks }, () => createGuiWidget('text', 'Block')),
    },
  };
}

const remove = (id: string): NodeChange => ({ type: 'remove', id });

describe('removalsToApply', () => {
  it('asks before a keystroke takes a whole interface', () => {
    let asked = '';
    const kept = removalsToApply([remove('a')], () => node('a', 3), (q) => { asked = q; return false; });
    expect(kept).toEqual([]);
    expect(asked).toMatch(/3 interface blocks/);
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
