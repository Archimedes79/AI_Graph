import { beforeEach, describe, expect, it } from 'vitest';
import type { GraphNode } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { useGraphStore } from '@/store/graphStore';
import { portRenames, trackPorts, untracked } from '@/store/portRenames';
import { withSetting } from '@/canvas/nodeDraft';

/**
 * Switching an input node's mode in its dialog, and saving: which wire stays.
 *
 * Done as the dialog does it (`NodeEditor`): each choice goes through
 * `withSetting`, which re-derives the draft's ports and asks the element which
 * new port carries on an old one, and Save moves the wires by what
 * `portRenames` makes of that.
 */
const store = () => useGraphStore.getState();
const stored = (id: string) => store().rfNodes.find((n) => n.id === id)!.data.graphNode as GraphNode;
/** Every wire out of *source*, as "port -> target". */
const outOf = (source: string) => store().rfEdges
  .filter((edge) => edge.source === source)
  .map((edge) => `${edge.sourceHandle} -> ${edge.target}`);

/** The dialog opened on *id*, its mode chosen once for each of *modes* in turn, and saved. */
function switchMode(id: string, ...modes: ('text' | 'file' | 'directory')[]) {
  const draft = modes.reduce(
    (node, mode) => withSetting(node, stored(id), 'input_mode', mode),
    trackPorts(JSON.parse(JSON.stringify(stored(id)))) as GraphNode,
  );
  store().updateNode(id, untracked(draft), portRenames(stored(id), draft));
}

beforeEach(() => {
  const source = NODE_KINDS.input.create('src');
  const reader = NODE_KINDS.code.create('code');
  store().loadGraph({
    metadata: { name: 'T', description: '', gui_scheme: 'night' },
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

  it('keeps the wire when the select is stepped through a folder on the way to a file', () => {
    // Arrow keys on the mode select pass every mode between: text, a folder,
    // then one file. The folder has no text port, and asked against the draft
    // a step earlier, the file's content no longer knew it carried on "output".
    switchMode('src', 'directory', 'file');
    expect(outOf('src')).toEqual(['content -> code']);
    switchMode('src', 'text', 'directory', 'file');
    expect(outOf('src')).toEqual(['content -> code']);
  });
});
