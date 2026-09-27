import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { derivedNodePorts } from '@/document/guiWidgets';
import { useGraphStore } from '@/store/graphStore';
import { portRenames, trackPorts, untracked } from '@/store/portRenames';
import { NODE_BUILDERS } from '@/elements/registry';

/**
 * Switching an input node's mode in its dialog, and saving: which wire stays.
 *
 * Done as the dialog does it (`NodeEditor`): the draft's ports are re-derived
 * from the new mode, the element says which new port carries on an old one,
 * and Save moves the wires by what `portRenames` makes of that.
 */
const store = () => useGraphStore.getState();
const stored = (id: string) => store().rfNodes.find((n) => n.id === id)!.data.graphNode as GraphNode;
/** Every wire out of *source*, as "port -> target". */
const outOf = (source: string) => store().rfEdges
  .filter((edge) => edge.source === source)
  .map((edge) => `${edge.sourceHandle} -> ${edge.target}`);

function switchMode(id: string, mode: 'text' | 'file' | 'directory') {
  const draft = trackPorts(JSON.parse(JSON.stringify(stored(id))));
  const next = { ...draft, config: { ...draft.config, input_mode: mode } };
  const after = NODE_BUILDERS.input.continuePorts(draft, { ...next, ...derivedNodePorts(next) });
  store().updateNode(id, untracked(after), portRenames(stored(id), after));
}

beforeEach(() => {
  const source = NODE_KINDS.input.create('src');
  const reader = NODE_KINDS.code.create('code');
  store().loadGraph({
    metadata: { name: 'T', version: '1.0.0', description: '', author: '', tags: [], ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night' },
    nodes: [source, reader],
    edges: [{ id: 'e', source_node_id: 'src', source_port_id: 'output', target_node_id: 'code', target_port_id: 'input' }],
  });
});

describe('an input node switched to another mode', () => {
  it('moves the wire from its text onto the file\'s content, and back: both are the text it hands on', () => {
    switchMode('src', 'file');
    expect(outOf('src')).toEqual(['content -> code']);
    switchMode('src', 'text');
    expect(outOf('src')).toEqual(['output -> code']);
  });

  it('lets the wire go when it lists a folder, which hands on paths instead of text', () => {
    switchMode('src', 'directory');
    expect(outOf('src')).toEqual([]);
  });
});
