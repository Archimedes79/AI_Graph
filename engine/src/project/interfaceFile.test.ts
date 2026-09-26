import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGraph } from '../graph.ts';
import { forgetSeen, loadGraph, saveGraph } from './folder.ts';
import { checkPath } from './check.ts';
import { NotAGraph } from '../errors.ts';

const port = (id: string, kind: 'input' | 'output', type = 'text', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, kind, data_type: type, multi: false, required: false, description: '', ...extra });

const graph = () => parseGraph({
  metadata: { name: 'interfaces' },
  nodes: [
    { id: 'page', node_type: 'gui', config: { gui_widgets: [{ id: 'go', kind: 'button' }, { id: 'len', kind: 'select', options: 'a\nb' }] },
      inputs: [], outputs: [port('go_out', 'output', 'boolean'), port('len_out', 'output')] },
    { id: 'count', node_type: 'code', label: 'Count', description: 'Counts the words',
      config: { code: 'function run(i) { return { words: 1 }; }', output_schema: { type: 'object', properties: { words: { type: 'integer' } } } },
      inputs: [port('length', 'input', 'text', { required: true, description: 'short or long', name: 'Length', multi: true })],
      outputs: [port('words', 'output', 'number')] },
    { id: 'show', node_type: 'output', config: {}, inputs: [port('value', 'input', 'any')], outputs: [] },
  ],
  edges: [
    { id: 'g', source_node_id: 'page', source_port_id: 'go_out', target_node_id: 'count', target_port_id: '__run' },
    { id: 'l', source_node_id: 'page', source_port_id: 'len_out', target_node_id: 'count', target_port_id: 'length' },
    { id: 's', source_node_id: 'count', source_port_id: 'words', target_node_id: 'show', target_port_id: 'value' },
  ],
});

async function saved(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'interfaces-'));
  forgetSeen();
  await saveGraph(dir, graph());
  return dir;
}

describe('interface.json', () => {
  it('says what goes in and what comes out, and the shape the node keeps -- nothing about its neighbours', async () => {
    const dir = await saved();
    const written = JSON.parse(await readFile(join(dir, 'nodes/count/interface.json'), 'utf8'));
    expect(written).toEqual({
      inputs: [{ port: 'length', name: 'Length', type: 'text', list: true, required: true, description: 'short or long' }],
      outputs: [{ port: 'words', type: 'number' }],
      output_schema: { type: 'object', properties: { words: { type: 'integer' } } },
    });
    // Where a port is wired from or to is the flow's to say, once.
    expect(JSON.stringify(written)).not.toMatch(/page|show/);
    // The kept shape lives here and nowhere else.
    expect(JSON.parse(await readFile(join(dir, 'nodes/count/node.json'), 'utf8')).config).not.toHaveProperty('output_schema');
  });

  it('is where the ports are kept: edited in the file, they are what opens', async () => {
    const dir = await saved();
    const path = join(dir, 'nodes/count/interface.json');
    const edited = JSON.parse(await readFile(path, 'utf8'));
    edited.outputs[0] = { port: 'words', type: 'number', description: 'how many' };
    edited.output_schema = { type: 'object', properties: { words: { type: 'number' } } };
    await writeFile(path, JSON.stringify(edited));
    forgetSeen();
    const count = (await loadGraph(dir)).nodes.find((node) => node.id === 'count')!;
    expect(count.outputs[0]).toMatchObject({ id: 'words', kind: 'output', data_type: 'number', description: 'how many' });
    expect(count.config.output_schema).toEqual({ type: 'object', properties: { words: { type: 'number' } } });
    expect(count.inputs[0]).toMatchObject({ id: 'length', name: 'Length', kind: 'input', multi: true, required: true });
  });

  it('says why when it is not an interface', async () => {
    const dir = await saved();
    await writeFile(join(dir, 'nodes/count/interface.json'), JSON.stringify({ inputs: 'length' }));
    forgetSeen();
    await expect(loadGraph(dir)).rejects.toThrow(NotAGraph);
    await expect(loadGraph(dir)).rejects.toThrow(/"inputs" must be a list of ports/);
  });

  it('belongs in the folder: check reports a stray file beside it, and not it', async () => {
    const dir = await saved();
    await writeFile(join(dir, 'nodes/count/notes.txt'), 'mine');
    const problems = (await checkPath(dir)).problems ?? [];
    expect(problems.map((problem) => problem.where)).toEqual(['nodes/count/notes.txt']);
  });
});
