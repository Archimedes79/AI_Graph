import { describe, it, expect } from 'vitest';
import { parseGraph, type GraphNode } from '../../graph.ts';
import { BUDGET, exampleFile, inputDefinition, outputDefinition, variables } from './brief.ts';

const port = (id: string, kind: 'input' | 'output', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '', ...extra });

const node = (config: Record<string, unknown> = {}): GraphNode => parseGraph({
  metadata: { name: 't' },
  nodes: [{
    id: 'rows', node_type: 'code', label: 'Rows', description: 'One row per file.',
    inputs: [port('files', 'input', { data_type: 'file_path', multi: true, description: 'Every file in the folder' }), port('top', 'input', { data_type: 'number' })],
    outputs: [port('rows', 'output', { multi: true }), port('error', 'output')],
    config,
  }],
  edges: [],
}).nodes[0];

describe('{Input Definition}', () => {
  it('is input.js as it is, while there is one', () => {
    expect(inputDefinition({ node: node({ input_definition: '  module.exports = { "top": 3 };\n' }) }, [])).toBe('module.exports = { "top": 3 };');
  });

  it('is each input from its wiring while there is none: its type, what it is, where from', () => {
    const said = inputDefinition({ node: node({ batch_mode: 'per_item' }), input_sources: { files: '"Page" (port "Folder")' } }, ['files']);
    expect(said).toBe([
      'None yet. Its inputs:',
      '- `files` (a path: the node reads the file there, and is handed its text): Every file in the folder',
      '  from "Page" (port "Folder")',
      '- `top` (number)',
      '  not wired yet',
      'A list arrives one item at a time: each call is handed one item.',
    ].join('\n'));
  });
});

describe('{Output Definition}', () => {
  it('is each output while there is no output.js: where it goes and what is wanted there -- the error port is the executor\'s', () => {
    expect(outputDefinition({ node: node(), output_targets: { rows: '"Page" (port "table"), which wants rows' } })).toBe([
      'None yet. Its outputs:',
      '- `rows`',
      '  to "Page" (port "table"), which wants rows',
    ].join('\n'));
  });

  it('is output.js as it is, while there is one', () => {
    expect(outputDefinition({ node: node({ output_definition: 'module.exports = { "rows": [] };' }) })).toBe('module.exports = { "rows": [] };');
  });
});

describe('{Example File}', () => {
  it('is its path and the start of it -- or that there is none, or that it could not be read', () => {
    expect(exampleFile(undefined)).toBe('None.');
    expect(exampleFile({ path: 'a.csv', text: 'x,y\n1,2' })).toBe('a.csv:\nx,y\n1,2');
    expect(exampleFile({ path: 'gone.csv' })).toBe('gone.csv (it could not be read)');
    expect(exampleFile({ path: 'big.csv', text: 'z'.repeat(BUDGET.exampleFile + 50) })).toMatch(/… \(50 more characters not shown\)$/);
  });
});

describe('every variable', () => {
  it('is filled, the graph around the node said as the editor built it', () => {
    const values = variables({ node: node(), context: 'Graph: Files' }, []);
    expect(values['Node Description']).toBe('# Rows (ID rows, code node)\n\nOne row per file.');
    expect(values.Context).toBe('Graph: Files');
    expect(variables({ node: node() }, []).Context).toBe('Not given.');
  });
});
