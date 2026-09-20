import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGraph } from '../graph.ts';
import { loadGraph, saveGraph } from './folder.ts';
import { checkPath } from './check.ts';

const port = (id: string, kind: 'input' | 'output', type = 'text', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, kind, data_type: type, multi: false, required: false, description: '', ...extra });

const graph = () => parseGraph({
  metadata: { name: 'interfaces' },
  nodes: [
    { id: 'page', node_type: 'gui', config: { gui_widgets: [{ id: 'go', kind: 'button' }, { id: 'len', kind: 'select', options: 'a\nb' }] },
      inputs: [], outputs: [port('go_out', 'output', 'boolean'), port('len_out', 'output')] },
    { id: 'count', node_type: 'code', label: 'Count', description: 'Counts the words',
      config: { code: 'function run(i) { return { words: 1 }; }', output_schema: { type: 'object', properties: { words: { type: 'integer' } } } },
      inputs: [port('length', 'input', 'text', { required: true, description: 'short or long' })], outputs: [port('words', 'output', 'number')] },
    { id: 'show', node_type: 'output', config: {}, inputs: [port('value', 'input', 'any')], outputs: [] },
  ],
  edges: [
    { id: 'g', source_node_id: 'page', source_port_id: 'go_out', target_node_id: 'count', target_port_id: '__run' },
    { id: 'l', source_node_id: 'page', source_port_id: 'len_out', target_node_id: 'count', target_port_id: 'length' },
    { id: 's', source_node_id: 'count', source_port_id: 'words', target_node_id: 'show', target_port_id: 'value' },
  ],
});

describe('interface.json', () => {
  it('says, in the node\'s own folder, what goes in, from where, what opens it and what comes out', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iface-'));
    await saveGraph(dir, graph());
    const written = JSON.parse(await readFile(join(dir, 'nodes', 'count', 'interface.json'), 'utf8'));
    expect(written).toMatchObject({
      node: 'count', type: 'code', label: 'Count', about: 'Counts the words',
      inputs: [{ port: 'length', type: 'text', required: true, description: 'short or long', from: ['page.len_out'] }],
      gate: ['page.go_out'],
      outputs: [{ port: 'words', type: 'number', to: ['show.value'] }],
      output_schema: { type: 'object', properties: { words: { type: 'integer' } } },
    });
    // What runs: the body beside it, for a node that has one ...
    expect(written.runs).toMatchObject({ by: 'body', where: 'code.js' });
    // Every node has one: an output node's folder says what it is shown,
    // ... and names the engine class that does the work, for one that has none.
    const shown = JSON.parse(await readFile(join(dir, 'nodes', 'show', 'interface.json'), 'utf8'));
    expect(shown.inputs[0].from).toEqual(['count.words']);
    expect(shown.runs).toMatchObject({ by: 'engine', where: 'engine/src/elements/nodes/output/OutputNodeElement.ts › execute' });
  });

  it('is rendered, never read back: edited outside, it is replaced and nothing is refused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iface-'));
    await saveGraph(dir, graph());
    const path = join(dir, 'nodes', 'count', 'interface.json');
    await writeFile(path, '{"inputs": [{"port": "renamed"}]}');
    const loaded = await loadGraph(dir);
    expect(loaded.nodes[1].inputs.map((p) => p.id)).toEqual(['length']);
    await saveGraph(dir, loaded);
    expect(JSON.parse(await readFile(path, 'utf8')).inputs[0].port).toBe('length');
    expect((await checkPath(dir)).problems).toEqual([]);
  });
});
