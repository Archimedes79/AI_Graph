import { beforeEach, describe, it, expect } from 'vitest';
import type { GraphNode } from '@/graph';
import { useGraphStore } from './graphStore';
import { NODE_KINDS } from '@/document/nodeKinds';
import { nodeDialog } from '@/canvas/nodeDialog';
import { enterGraphOf } from '@/elements/nodes/subgraph/SubgraphNodePanel';

// Held here, beside the store it goes in and out of, because the rule is its
// own: what a node's dialog still holds is written into the graph the dialog
// was opened in, before the canvas goes into the node -- and without the
// marks the dialog puts on its ports (`trackPorts`), which are never stored.

const store = () => useGraphStore.getState();
const stored = (id: string) => store().rfNodes.find((item) => item.id === id)?.data.graphNode as GraphNode | undefined;

beforeEach(() => {
  store().loadGraph({ metadata: { name: 'Outer', description: '', gui_scheme: 'night' }, nodes: [NODE_KINDS.subgraph.create('part')], edges: [] });
});

describe('going into a node\'s graph from its dialog', () => {
  it('writes what the dialog still holds into the graph out here first, as a node is stored', () => {
    store().setEditingNode('part');
    const dialog = nodeDialog('part');
    const stop = dialog.watch(() => {});
    dialog.setConfig('prompt', 'Summarise');
    enterGraphOf('part');
    stop();

    expect(store().subgraphStack).toHaveLength(1);
    store().closeSubgraph();
    const part = stored('part')!;
    expect(part.config.prompt).toBe('Summarise');
    for (const kept of [...part.inputs, ...part.outputs]) {
      expect(Object.getOwnPropertySymbols(kept)).toEqual([]);
    }
  });
});
