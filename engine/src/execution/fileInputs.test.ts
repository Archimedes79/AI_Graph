import { describe, it, expect } from 'vitest';
import { filePorts, readPorts } from './fileInputs.ts';
import { executeGraph, executeNode } from './executor.ts';
import { LastOutputs } from './reuse.ts';
import { registry } from '../elements/registry.ts';
import type { FileService, Runtime } from '../elements/Runtime.ts';
import type { DataType, Graph, GraphNode, Port } from '../graph.ts';
import { edge, graphOf } from '../../test/fakes.ts';

/**
 * Which inputs are paths to be read, and who gets to say so: the port itself,
 * ticked "Read the file at this path" (typed `file_path`) -- nothing else.
 */

const port = (id: string, data_type: DataType): Port => ({
  id, name: id, kind: 'input', data_type, multi: false, required: false, description: '',
});

const node = (inputs: Port[], type: GraphNode['node_type'] = 'code'): GraphNode => ({
  id: 'code', node_type: type, label: 'Code', description: '',
  position: { x: 0, y: 0 }, inputs, outputs: [port('out', 'any')].map((p) => ({ ...p, kind: 'output' as const })),
  config: { code: 'function run(inputs) { return { out: inputs }; }' },
});

describe('which inputs are read', () => {
  it('takes the ports that say so themselves, and only those', () => {
    expect(filePorts(node([port('csv', 'file_path'), port('kind', 'text'), port('input', 'any')]), registry)).toEqual(['csv']);
  });

  it('takes none on a node whose kind takes a path as a path, whatever its port says', () => {
    // Said once, here: the run, check, what a run asks for first and the
    // editor each put the kind's rule beside the port's themselves.
    expect(filePorts(node([port('path', 'file_path')], 'output'), registry)).toEqual([]);
  });
});

const files: FileService = {
  resolve: (path) => path, exists: async () => true, write: async () => {}, list: async () => [],
  read: async (path) => { if (!path) throw new Error("ENOENT: no such file or directory, open ''"); return `content of ${path}`; },
};

describe('a run, with a picker wired in', () => {
  /** A page whose file picker hands on paths, wired into both inputs of *reader*. */
  const graph = (reader: GraphNode): Graph => ({
    metadata: { name: 'Files' } as Graph['metadata'],
    nodes: [
      {
        id: 'page', node_type: 'gui', label: 'Page', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [],
        config: { gui_widgets: [{ id: 'file', kind: 'input_picker', mode: 'file', label: 'File' }] },
      },
      reader,
    ],
    edges: reader.inputs.map((input) => ({
      id: input.id, source_node_id: 'page', source_port_id: 'file_out', target_node_id: 'code', target_port_id: input.id,
    })),
  });
  const runtime = (): Runtime => ({
    files,
    code: { run: async (_body, inputs) => ({ out: inputs }) },
    ai: { complete: async () => '' },
  });
  const handed = async (reader: GraphNode) => {
    const result = await executeNode(graph(reader), 'code', { file: 'a.csv', path: 'a.csv' }, { runtime: runtime(), registry });
    return result.outputs.out;
  };

  it('reads the file on the port ticked to read it, and leaves the one that keeps the name a path', async () => {
    // A file reader takes the same picker output twice: once to be read, once
    // to keep the name for the line it prints about the file.
    expect(await handed(node([port('file', 'file_path'), port('path', 'text')]))).toEqual({ file: 'content of a.csv', path: 'a.csv' });
  });

  it('never reads a port that did not say so, whatever hands it a path -- the wire does not decide', async () => {
    expect(await handed(node([port('file', 'any'), port('path', 'any')]))).toEqual({ file: 'a.csv', path: 'a.csv' });
  });

  it('is done for a kind that declares it, and not for one that takes a path as a path', () => {
    expect(registry.node('code')?.readsFileInputs).toBe(true);
    expect(registry.node('ai')?.readsFileInputs).toBe(true);
    for (const kind of ['input', 'output', 'data', 'gui', 'subgraph', 'trigger']) expect(registry.node(kind)?.readsFileInputs, kind).toBe(false);
  });
});

describe('reading wired files into their content', () => {
  it('reads a path, and every path of a list, on the ports that carry paths -- and leaves the rest alone', async () => {
    const read = await readPorts({ one: 'a.txt', many: ['b.txt', 'c.txt'], other: 'd.txt' }, ['one', 'many'], files);
    expect(read).toEqual({ one: 'content of a.txt', many: ['content of b.txt', 'content of c.txt'], other: 'd.txt' });
  });

  it('takes no path for no file: a picker nobody has used hands on "", and the node is there to say so', async () => {
    // It used to fail with `ENOENT: open ''` before the node ran at all.
    expect(await readPorts({ one: '', many: ['', 'b.txt'], blank: '   ' }, ['one', 'many', 'blank'], files))
      .toEqual({ one: '', many: ['', 'content of b.txt'], blank: '' });
  });
});

describe('a node run once per item, handed a file per item', () => {
  /** A code node that runs once per file on `file`, and hands on what it was handed. */
  const perItem = (config: Record<string, unknown> = {}): Graph => ({
    metadata: { name: 'Files' } as Graph['metadata'],
    nodes: [{
      id: 'each', node_type: 'code', label: 'Each', description: '', position: { x: 0, y: 0 },
      inputs: [{ ...port('file', 'file_path'), multi: true }],
      outputs: [{ ...port('out', 'any'), kind: 'output', multi: true }],
      config: { code: 'x', batch_mode: 'per_item', ...config },
    }],
    edges: [],
  });
  const reading = (read: FileService['read']): Runtime => ({
    files: { ...files, read },
    code: { run: async (_body, inputs) => ({ out: inputs.file }) },
    ai: { complete: async () => '' },
  });

  it('loses that item, not the node, to a file it cannot read', async () => {
    // One file nobody may read took every other file's result with it.
    const runtime = reading(async (path) => {
      if (path === 'b.txt') throw new Error("EACCES: permission denied, open 'b.txt'");
      return `content of ${path}`;
    });
    const result = await executeNode(perItem(), 'each', { file: ['a.txt', 'b.txt', 'c.txt'] }, { runtime, registry });
    expect(result.status).toBe('partial');
    expect(result.outputs.out).toEqual(['content of a.txt', null, 'content of c.txt']);
    expect(result.error).toBe("1 of 3 items failed: item 2: Reading its input files: EACCES: permission denied, open 'b.txt'");
  });

  it('reads no more of its files at once than it runs items at once', async () => {
    // Two hundred files were two hundred reads in flight, whatever the node said.
    let open = 0;
    let most = 0;
    const runtime = reading(async (path) => {
      most = Math.max(most, ++open);
      await new Promise((wait) => setTimeout(wait, 2));
      open -= 1;
      return `content of ${path}`;
    });
    const paths = Array.from({ length: 20 }, (_, at) => `${at}.txt`);
    const result = await executeNode(perItem({ batch_concurrency: 2 }), 'each', { file: paths }, { runtime, registry });
    expect(result.status).toBe('success');
    expect(result.outputs.out).toEqual(paths.map((path) => `content of ${path}`));
    expect(most).toBe(2);
  });

  it('is handed back, run as context, only while what its files say is the same', async () => {
    // Read file by file, and still before any item runs: what it depends on is
    // what the files say, not their names (`reuse.ts`).
    const says: Record<string, string> = { 'a.txt': 'one', 'b.txt': 'two' };
    let calls = 0;
    const runtime: Runtime = {
      files: { ...files, read: async (path) => says[path] },
      code: { run: async (body, inputs) => (body === 'each' ? (calls += 1, { out: inputs.file }) : body === 'list' ? { paths: ['a.txt', 'b.txt'] } : inputs) },
      ai: { complete: async () => '' },
    };
    const graph = graphOf([
      { ...perItem().nodes[0], config: { code: 'each', batch_mode: 'per_item' } },
      { id: 'list', node_type: 'code', label: 'List', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [{ ...port('paths', 'file_path'), kind: 'output', multi: true }], config: { code: 'list' } },
      { id: 'page', node_type: 'gui', label: 'Page', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config: { gui_widgets: [{ id: 'len', kind: 'select', options: 'short\nlong', value: 'short', run_on_change: true }] } },
      { id: 'shape', node_type: 'code', label: 'Shape', description: '', position: { x: 0, y: 0 }, inputs: [port('text', 'any'), port('len', 'any')], outputs: [], config: { code: 'shape' } },
    ], [edge('p', 'list', 'paths', 'each', 'file'), edge('t', 'each', 'out', 'shape', 'text'), edge('l', 'page', 'len_out', 'shape', 'len')]);
    const reuse = new LastOutputs();
    const round = () => executeGraph(graph, { runtime, registry, reuse, trigger: { node_id: 'page', port_id: 'len_out' } });
    await round();
    await round();
    expect(calls).toBe(2);
    says['b.txt'] = 'two, rewritten';
    const changed = await round();
    expect(calls).toBe(4);
    expect(changed.node_results.find((result) => result.node_id === 'each')?.outputs.out).toEqual(['one', 'two, rewritten']);
  });
});
