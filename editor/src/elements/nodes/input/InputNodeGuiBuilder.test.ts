import { beforeEach, describe, expect, it } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { useGraphStore } from '@/store/graphStore';
import { nodeDialog } from '@/canvas/nodeDialog';

/**
 * Switching an input node's mode in its dialog: which wire stays.
 *
 * Done as the dialog does it (`nodeDialog`): each choice goes through
 * `withSetting`, which re-derives the node's ports, and the write moves the
 * wires by what `portRenames` makes of that -- a port of the same name keeps
 * its wire, and a port that is gone takes its wire with it.
 */
const store = () => useGraphStore.getState();
/** Every wire out of *source*, as "port -> target". */
const outOf = (source: string) => store().rfEdges
  .filter((edge) => edge.source === source)
  .map((edge) => `${edge.sourceHandle} -> ${edge.target}`);

/** The dialog opened on *id*, its mode chosen once for each of *modes* in turn -- quicker than a write -- and written. */
function switchMode(id: string, ...modes: ('text' | 'directory')[]) {
  const dialog = nodeDialog(id);
  for (const mode of modes) dialog.setConfig('input_mode', mode);
  dialog.write();
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
  it('lets the wire go when it lists a folder, which hands on paths instead of text', () => {
    switchMode('src', 'directory');
    expect(outOf('src')).toEqual([]);
  });

  it('keeps the wire when the select is stepped through a folder and back to text', () => {
    switchMode('src', 'directory', 'text');
    expect(outOf('src')).toEqual(['output -> code']);
  });
});
