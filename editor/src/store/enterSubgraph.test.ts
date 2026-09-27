import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { GraphNode, Port } from '@/graph';
import { trackPorts } from './portRenames';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import SubgraphNodePanel from '@/elements/nodes/subgraph/SubgraphNodePanel';

// Held here, beside `portRenames`, because the rule is its own: the marks
// `trackPorts` puts on a dialog's draft are never stored, whichever way the
// draft leaves the dialog. A Save strips them; this is the other way out.
//
// What going in asks of the store, written down instead of done: the question
// is what the store is handed, not what it then makes of it. (Vitest lifts
// both of these above the imports.)
const asked = vi.hoisted(() => ({ stored: [] as unknown[] }));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: {
    getState: () => ({
      updateNode: (_id: string, node: unknown) => { asked.stored.push(node); },
      setEditingNode: () => {},
      openSubgraph: () => {},
    }),
  },
}));

const port = (id: string, kind: 'input' | 'output'): Port =>
  ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });

/** The button that goes in, as the panel made it. */
function openButton(node: GraphNode): ReactElement<{ onClick: () => void }> {
  let found: ReactElement<{ onClick: () => void }> | undefined;
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

describe('going into a node\'s graph from its dialog', () => {
  it('stores the draft as a node is stored, without the marks the dialog put on its ports', () => {
    // The dialog edits a draft whose ports remember the id they had when it
    // opened (`trackPorts`). Those marks are the dialog's, and a Save strips
    // them; going in stored the draft as it was.
    const node: GraphNode = {
      id: 'part', node_type: 'subgraph', label: 'Part', description: '', position: { x: 0, y: 0 },
      inputs: [port('paper', 'input')], outputs: [port('summary', 'output')], config: { ...baseNodeConfig(), task: 'Summarise' },
    };
    openButton(trackPorts(node)).props.onClick();

    const stored = asked.stored[0] as GraphNode;
    expect(stored.config.task).toBe('Summarise');
    for (const kept of [...stored.inputs, ...stored.outputs]) {
      expect(Object.getOwnPropertySymbols(kept)).toEqual([]);
    }
  });
});
