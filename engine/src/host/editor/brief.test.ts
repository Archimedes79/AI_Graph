import { describe, it, expect } from 'vitest';
import { PROMPT_VARIABLES } from '../../authoring/promptFile.ts';
import { promptVariables } from './brief.ts';

/**
 * What the three variables of a node's `prompt.md` say, as the person reads
 * them in what ✨ sends: each says something even for a node that has nothing
 * yet, so the template never reads as a heading over nothing.
 */
describe('the variables of a node\'s prompt', () => {
  const request = {
    element: 'code', prompt: 'Count the rows.', inputs: ['csv', 'top'], outputs: ['count'],
    input_types: { csv: 'file_path', top: 'number' }, read_file_ports: ['csv'],
    input_sources: { csv: '"Page" (port "CSV file")' },
    output_targets: { count: '"Result" (port "Value")' },
    output_format: 'The number of data rows, without the header.',
    examples: '## Two rows\n\n```json input\n{"csv": "example/rows.csv", "top": 1}\n```\n\n```json expect\n{"count": 2}\n```\n',
  };

  it('are exactly the three the template may name', () => {
    expect(Object.keys(promptVariables(request, 'code')).sort()).toEqual([...PROMPT_VARIABLES].sort());
  });

  it('say each input -- its type, that its file is read, where from -- and its sample only where there is one', () => {
    const needs = promptVariables(request, 'code', { values: { csv: 'a\nb', top: 1 }, origin: 'the last run' })['Input Needs'];
    expect(needs).toContain('- `csv` (file_path)\n  a path: the node reads the file there, and is handed its text\n  from "Page" (port "CSV file")');
    expect(needs).toContain('sample, from the last run: "a\\nb"');
    expect(needs).toContain('- `top` (number)\n  not wired yet');
    expect(promptVariables(request, 'code')['Input Needs']).not.toContain('sample');
  });

  it('say each output, where it goes, its definition and what the examples must give', () => {
    const example = promptVariables(request, 'code')['Output Example'];
    expect(example).toContain('- `count`\n  to "Result" (port "Value")');
    expect(example).toContain('Its output definition (output.md):\nThe number of data rows, without the header.');
    expect(example).toContain('Examples -- the result is checked against these:\n- Two rows');
    expect(example).toContain('must return, at least: {"count":2}');
  });

  it('say so where a node has nothing yet', () => {
    const empty = promptVariables({ element: 'code', prompt: '' }, 'code');
    expect(empty).toEqual({ 'Input Needs': 'Nothing is wired in.', 'Output Example': 'Nothing is said about it yet.', Graph: 'Not given.' });
  });

  it('carry the graph around the node where the request says it', () => {
    expect(promptVariables({ ...request, graph_context: 'A page with one chart.' }, 'code').Graph).toBe('A page with one chart.');
  });
});
