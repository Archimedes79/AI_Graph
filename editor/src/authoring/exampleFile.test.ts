import { describe, it, expect } from 'vitest';
import type { ExecutionResult, GraphNode, Wire } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { filesOf, withFile } from '@/document/givenFiles';
import { inputFilesOf } from './exampleFile';
import { tryKey } from './TryExample';

/**
 * The files ✨ Input writes a node's input definition from: the node's own --
 * examples, a spec -- and otherwise the one the graph hands a file-reading
 * input of it.
 */

/** A code node whose input `csv` reads the file at the path it is handed. */
function reader(config: Record<string, unknown> = {}): GraphNode {
  const node = NODE_KINDS.code.create('reader');
  return { ...node, inputs: [{ ...node.inputs[0], id: 'csv', name: 'csv', data_type: 'file_path' }], config: { ...node.config, ...config } };
}

/** A text input holding *path*, wired into the reader's `csv`. */
function typed(path: string): { nodes: GraphNode[]; edges: Wire[] } {
  const source = { ...NODE_KINDS.input.create('path'), config: { ...NODE_KINDS.input.create('path').config, value: path } };
  return { nodes: [source, reader()], edges: [{ source: 'path', sourceHandle: 'output', target: 'reader', targetHandle: 'csv' }] };
}

const ran = (inputs: Record<string, unknown>): ExecutionResult => ({
  status: 'success', outputs: {}, node_results: [{ node_id: 'reader', status: 'success', inputs, outputs: {} }],
} as ExecutionResult);

describe('the files ✨ Input writes from', () => {
  it('are the node\'s own, where it was given some', () => {
    const { nodes, edges } = typed('data/typed.csv');
    expect(inputFilesOf(reader({ input_files: ['data/a.csv', 'spec.md'] }), nodes, edges, null)).toEqual(['data/a.csv', 'spec.md']);
  });

  it('are otherwise the file the last run handed a file-reading input -- or what is wired to it holds', () => {
    const { nodes, edges } = typed('data/typed.csv');
    expect(inputFilesOf(reader(), nodes, edges, ran({ csv: ['data/ran.csv', 'data/second.csv'] }))).toEqual(['data/ran.csv']);
    expect(inputFilesOf(reader(), nodes, edges, null)).toEqual(['data/typed.csv']);
  });

  it('are none where nothing hands it a file: an input that reads no file is not asked', () => {
    const { nodes, edges } = typed('data/typed.csv');
    expect(inputFilesOf(reader(), [], [], null)).toEqual([]);
    const words = { ...reader(), inputs: [{ ...reader().inputs[0], data_type: 'any' as const }] };
    expect(inputFilesOf(words, nodes, edges, null)).toEqual([]);
  });
});

describe('a file given to a ✨', () => {
  it('is added once: a file given twice is still one, and the node itself', () => {
    const once = withFile(reader(), 'input', 'data/a.csv');
    expect(filesOf(once, 'input')).toEqual(['data/a.csv']);
    expect(withFile(once, 'input', 'data/a.csv')).toBe(once);
    expect(filesOf(withFile(once, 'output', 'spec.md'), 'output')).toEqual(['spec.md']);
    expect(filesOf(once, 'output')).toEqual([]);
  });

  it('changes nothing a try runs: ▶ Try\'s result stays on screen', () => {
    const node = reader({ input_definition: 'module.exports = { "csv": "a" };' });
    expect(tryKey(withFile(withFile(node, 'input', 'data/a.csv'), 'output', 'spec.md'))).toBe(tryKey(node));
    expect(tryKey({ ...node, config: { ...node.config, prompts: { body: 'Mine.' }, history: '## …' } })).toBe(tryKey(node));
    expect(tryKey({ ...node, config: { ...node.config, code: 'function run() { return {}; }' } })).not.toBe(tryKey(node));
  });
});
