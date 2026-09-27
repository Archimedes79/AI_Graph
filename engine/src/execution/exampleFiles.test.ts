import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { executeGraph, executeNode } from './executor.ts';
import { exampleFilesOf, isExampleFileName, withExampleFiles } from './exampleFiles.ts';
import { graphOf, quietRuntime } from '../../test/fakes.ts';

/** A disk that has one file, "data/real.csv", and nothing else. */
const disk = quietRuntime({
  files: {
    read: async (path) => { if (path === 'data/real.csv') return 'real'; throw new Error(`ENOENT: ${path}`); },
    exists: async (path) => path === 'data/real.csv',
  },
}).files;

describe('an example file\'s name', () => {
  it('is "example/<name>", one level down, either slash', () => {
    expect(isExampleFileName('example/rows.csv')).toBe(true);
    expect(isExampleFileName('example\\rows.csv')).toBe(true);
  });

  it('never leads out of the node\'s folder', () => {
    for (const name of ['example/../code.js', 'example/..', 'example/sub/rows.csv', '/example/rows.csv', 'C:/example/rows.csv',
      'examples/rows.csv', 'rows.csv', 'example/', 'example/rows.csv:hidden']) {
      expect(isExampleFileName(name), name).toBe(false);
    }
  });

  it('is what a node holds under example_files, and nothing else there', () => {
    const node = { config: { example_files: { 'example\\a.csv': 'a', 'example/../b': 'b', 'example/c.txt': 3 } } };
    expect(exampleFilesOf(node)).toEqual({ 'example/a.csv': 'a' });
    expect(exampleFilesOf({ config: {} })).toEqual({});
  });
});

describe('a disk with the example files on it', () => {
  const files = withExampleFiles(disk, { 'example/rows.csv': 'name\nAda' });

  it('reads and finds them first, either slash', async () => {
    expect(await files.read('example/rows.csv')).toBe('name\nAda');
    expect(await files.read('example\\rows.csv')).toBe('name\nAda');
    expect(await files.exists('example/rows.csv')).toBe(true);
  });

  it('hands every other path on to the disk', async () => {
    expect(await files.read('data/real.csv')).toBe('real');
    expect(await files.exists('example/other.csv')).toBe(false);
    await expect(files.read('example/other.csv')).rejects.toThrow(/ENOENT/);
  });

  it('reads one in binary mode as its bytes', async () => {
    const accented = withExampleFiles(disk, { 'example/a.txt': 'é' });
    expect(await accented.read('example/a.txt', 'binary')).toBe(btoa('\u00c3\u00a9'));
  });

  it('is the disk itself when there are none', () => {
    expect(withExampleFiles(disk, {})).toBe(disk);
  });
});

describe('a node tried on its example', () => {
  const reader = (): GraphNode => ({
    id: 'reader', node_type: 'code', label: 'Reader', description: '', position: { x: 0, y: 0 },
    inputs: [{ id: 'csv', name: 'CSV', kind: 'input', data_type: 'file_path', multi: false, required: false, description: '' }],
    outputs: [{ id: 'text', name: 'Text', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    config: { code: 'function run(i) { return { text: i.csv }; }', example_files: { 'example/rows.csv': 'name\nAda' } },
  });
  const runtime = quietRuntime({
    files: disk,
    code: { run: async (_body, inputs) => ({ text: inputs.csv }) },
  });

  it('reads the file its example names from its own example files', async () => {
    const result = await executeNode(graphOf([reader()]), 'reader', { csv: 'example/rows.csv' }, { runtime, registry });
    expect(result).toMatchObject({ status: 'success', outputs: { text: 'name\nAda' } });
  });

  it('reads every other path from the disk, as before', async () => {
    const result = await executeNode(graphOf([reader()]), 'reader', { csv: 'data/real.csv' }, { runtime, registry });
    expect(result.outputs).toEqual({ text: 'real' });
  });

  it('is not read from them in a run of the graph: they are the example\'s', async () => {
    const graph = graphOf([
      {
        id: 'path', node_type: 'input', label: 'Path', description: '', position: { x: 0, y: 0 }, inputs: [],
        outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
        config: { input_mode: 'text', value: 'example/rows.csv' },
      },
      reader(),
    ], [{ id: 'e', source_node_id: 'path', source_port_id: 'output', target_node_id: 'reader', target_port_id: 'csv' }]);
    const run = await executeGraph(graph, { runtime, registry });
    expect(run.node_results.find((result) => result.node_id === 'reader')?.error).toMatch(/ENOENT: example\/rows\.csv/);
  });
});
