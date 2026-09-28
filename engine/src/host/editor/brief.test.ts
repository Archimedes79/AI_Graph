import { describe, it, expect } from 'vitest';
import { parseGraph, type GraphNode } from '../../graph.ts';
import { BUDGET, filesPart, inputDefinition, outputDefinition, variables } from './brief.ts';

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
  it('is each input as wired while there is no input.js: its type, what it is, where from', () => {
    const said = inputDefinition({ node: node({ batch_mode: 'per_item' }), input_sources: { files: '"Page" (port "Folder")' } }, ['files']);
    expect(said).toBe([
      'None yet. Its inputs, as wired:',
      '- `files` (a path: the node reads the file there, and is handed its text): Every file in the folder',
      '  from "Page" (port "Folder")',
      '- `top` (number)',
      '  not wired yet',
      'A list arrives one item at a time: each call is handed one item.',
    ].join('\n'));
  });

  it('is input.js as it is, and after it still each input as wired: what arrives there is not in the file', () => {
    const said = inputDefinition({
      node: node({ input_definition: '  module.exports = { "top": 3 };\n' }),
      input_sources: { top: '"Capitals" (port "output"), which hands on: structure; it holds: [{"capital":"Paris"}]' },
    }, []);
    expect(said).toBe([
      'module.exports = { "top": 3 };',
      '',
      'Its inputs, as wired:',
      '- `files` (file_path): Every file in the folder',
      '  not wired yet',
      '- `top` (number)',
      '  from "Capitals" (port "output"), which hands on: structure; it holds: [{"capital":"Paris"}]',
    ].join('\n'));
  });
});

describe('{Output Definition}', () => {
  it('is each output as wired while there is no output.js: where it goes and what is wanted there -- the error port is the executor\'s', () => {
    expect(outputDefinition({ node: node(), output_targets: { rows: '"Page" (port "table"), which wants rows' } })).toBe([
      'None yet. Its outputs, as wired:',
      '- `rows`',
      '  to "Page" (port "table"), which wants rows',
    ].join('\n'));
  });

  it('is output.js as it is, and after it still each output as wired: what the node there wants is not in the file', () => {
    expect(outputDefinition({ node: node({ output_definition: 'module.exports = { "rows": [] };' }), output_targets: { rows: '"Page" (port "table"), which wants rows' } }))
      .toBe('module.exports = { "rows": [] };\n\nIts outputs, as wired:\n- `rows`\n  to "Page" (port "table"), which wants rows');
  });

  it('is only the wiring for a node that keeps no definitions -- a data node: what it feeds', () => {
    const data = parseGraph({
      metadata: { name: 't' },
      nodes: [{ id: 'held', node_type: 'data', label: 'Held', description: 'Capitals.', inputs: [port('input', 'input')], outputs: [port('output', 'output')], config: { data_format: 'structure' } }],
      edges: [],
    }).nodes[0];
    expect(outputDefinition({ node: data, output_targets: { output: '"Sort" (port "input")' } })).toBe('- `output`\n  to "Sort" (port "input")');
  });
});

describe('{Example Files} and {Output Files}', () => {
  it('are each path and the start of the file -- or that there are none, or that one could not be read', () => {
    expect(filesPart(undefined)).toBe('None.');
    expect(filesPart([{ path: 'a.csv', text: 'x,y\n1,2' }, { path: 'gone.csv' }])).toBe('a.csv:\nx,y\n1,2\n\ngone.csv (it could not be read)');
  });

  it('share one budget: small files whole, a big one cut to what is left', () => {
    const big = 'z'.repeat(BUDGET.files * 2);
    const said = filesPart([{ path: 'big.txt', text: big }, { path: 'small.txt', text: 'tiny' }]);
    expect(said).toContain('small.txt:\ntiny');
    expect(said).toMatch(new RegExp(`big\\.txt:\\nz{${BUDGET.files - 4}}… \\(`));
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
