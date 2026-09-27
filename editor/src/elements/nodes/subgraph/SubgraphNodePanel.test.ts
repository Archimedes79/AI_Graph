import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { GraphNode } from '@/graph';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import SubgraphNodePanel from './SubgraphNodePanel';

// What the panel asks of the store, written down instead of done. (Vitest
// lifts both of these above the imports.)
const asked = vi.hoisted(() => ({ isExecuting: false }));
vi.mock('@/store/graphStore', () => {
  const state = { get isExecuting() { return asked.isExecuting; } };
  return { useGraphStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }) };
});

/** The button that goes in, as the panel made it. */
function openButton(node: GraphNode): ReactElement<{ onClick: () => void; disabled: boolean; title?: string }> {
  let found: ReactElement<{ onClick: () => void; disabled: boolean; title?: string }> | undefined;
  const walk = (child: unknown): void => {
    if (Array.isArray(child)) { child.forEach(walk); return; }
    if (!child || typeof child !== 'object' || !('props' in child)) return;
    const element = child as ReactElement<{ children?: unknown; onClick?: () => void }>;
    if (element.type === 'button' && !found) found = element as never;
    walk(element.props.children);
  };
  walk(SubgraphNodePanel({ node, setConfig: () => {} } as never));
  return found!;
}

describe('a node that holds a graph', () => {
  it('waits while a run is going, and says so, rather than close the dialog and open nothing (B36)', () => {
    const node: GraphNode = {
      id: 'part', node_type: 'subgraph', label: 'Part', description: '', position: { x: 0, y: 0 },
      inputs: [], outputs: [], config: { ...baseNodeConfig(), subgraph: { metadata: {}, nodes: [], edges: [] } },
    };
    asked.isExecuting = true;
    try {
      expect(openButton(node).props.disabled).toBe(true);
      expect(openButton(node).props.title).toMatch(/A run is going on/);
    } finally {
      asked.isExecuting = false;
    }
    expect(openButton(node).props.disabled).toBe(false);
  });
});
