import { describe, it, expect } from 'vitest';
import { connectedFormatContext, lastRunContext, describeNodeOutput } from './generationContext';
import { NODE_ELEMENTS } from '../registry';
import type { ExecutionResult } from '../../types/graph';

const edge = (source: string, target: string) => ({ source, target });

describe('connectedFormatContext', () => {
  it('still describes data nodes on both sides, in the wording prompts were tuned to', () => {
    const source = NODE_ELEMENTS.data.create('source');
    source.label = 'Input records';
    source.config.data_format = 'structure';
    source.config.data_format_prompt = 'columns: id integer, name text';
    const processor = NODE_ELEMENTS.code.create('processor');
    const target = NODE_ELEMENTS.data.create('target');
    target.label = 'Result map';
    target.config.data_format = 'structure';

    const context = connectedFormatContext('processor', [source, processor, target], [
      edge('source', 'processor'), edge('processor', 'target'),
    ]);

    expect(context).toContain('Source data format from "Input records": structure: columns: id integer, name text');
    expect(context).toContain('Target data format required by "Result map": structure');
  });

  it('describes a non-data upstream node too', () => {
    // The old version considered `data` nodes only, so this -- the commonest
    // wiring there is -- produced no context at all.
    const input = NODE_ELEMENTS.input.create('src');
    input.label = 'Reports folder';
    input.config.input_mode = 'directory';
    const code = NODE_ELEMENTS.code.create('worker');

    const context = connectedFormatContext('worker', [input, code], [edge('src', 'worker')]);

    expect(context).toContain('Input from "Reports folder" (input node): a list of file paths');
  });

  it('carries an upstream ai node\'s declared output format', () => {
    const ai = NODE_ELEMENTS.ai.create('classifier');
    ai.label = 'Classifier';
    ai.config.output_format = 'json';
    const code = NODE_ELEMENTS.code.create('worker');

    const context = connectedFormatContext('worker', [ai, code], [edge('classifier', 'worker')]);
    expect(context).toContain('Input from "Classifier" (ai node): json');
  });

  it('is empty for an unconnected node rather than noise', () => {
    const code = NODE_ELEMENTS.code.create('lonely');
    expect(connectedFormatContext('lonely', [code], [])).toBe('');
  });
});

describe('describeNodeOutput', () => {
  it('distinguishes the input node modes', () => {
    const node = NODE_ELEMENTS.input.create('i');
    node.config.input_mode = 'file';
    expect(describeNodeOutput(node)).toBe('a file path');
    node.config.input_mode = 'text';
    expect(describeNodeOutput(node)).toBe('text');
  });

  it('spells out a custom output format', () => {
    const node = NODE_ELEMENTS.code.create('c');
    node.config.output_format = 'custom';
    node.config.output_format_prompt = 'one line per finding';
    expect(describeNodeOutput(node)).toBe('custom: one line per finding');
  });
});

describe('lastRunContext', () => {
  const resultWith = (inputs: Record<string, unknown>): ExecutionResult => ({
    status: 'success',
    node_results: [{ node_id: 'worker', status: 'success', inputs, outputs: {} }],
    outputs: {},
  } as ExecutionResult);

  it('reports the values a node actually received', () => {
    const context = lastRunContext('worker', resultWith({ rows: [{ id: 1 }, { id: 2 }] }));
    expect(context).toContain('Actual values this node received on its last run');
    expect(context).toContain('rows (list of 2)');
    expect(context).toContain('"id": 1');
  });

  it('truncates a large value instead of sending the whole file', () => {
    const context = lastRunContext('worker', resultWith({ text: 'x'.repeat(5000) }));
    expect(context).toContain('… (truncated)');
    expect(context.length).toBeLessThan(2000);
  });

  it('says nothing before the first run, or for another node', () => {
    expect(lastRunContext('worker', null)).toBe('');
    expect(lastRunContext('someone-else', resultWith({ a: 1 }))).toBe('');
    expect(lastRunContext('worker', resultWith({}))).toBe('');
  });
});

describe('duplicate neighbours', () => {
  it('states a shared neighbour once, not once per wire', () => {
    // Two output ports into the same Output node is two edges and one fact.
    const code = NODE_ELEMENTS.code.create('worker');
    const out = NODE_ELEMENTS.output.create('sink');
    out.label = 'Result';

    const context = connectedFormatContext('worker', [code, out], [
      edge('worker', 'sink'), edge('worker', 'sink'),
    ]);

    expect(context).toBe('Output goes to "Result" (output node).');
  });
});
