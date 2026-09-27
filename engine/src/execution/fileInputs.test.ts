import { describe, it, expect } from 'vitest';
import { filePorts, readPorts } from './fileInputs.ts';
import { executeNode } from './executor.ts';
import { registry } from '../elements/registry.ts';
import type { FileService, Runtime } from '../elements/Runtime.ts';
import type { DataType, Graph, GraphNode, Port } from '../graph.ts';

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
    expect(filePorts(node([port('csv', 'file_path'), port('kind', 'text'), port('input', 'any')]))).toEqual(['csv']);
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
