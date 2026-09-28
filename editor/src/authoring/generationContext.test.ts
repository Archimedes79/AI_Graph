import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { describeNodeOutput, inputSources, lastRunInputs, outputTargets, readFilePorts } from './generationContext';
import type { ExecutionResult } from '@/graph';

const edge = (source: string, target: string) => ({ source, target, sourceHandle: 'output', targetHandle: 'input' });

describe('what ✨ is told of a node\'s neighbours', () => {
  it('describes data nodes on both sides by their format', () => {
    const source = NODE_KINDS.data.create('source');
    source.label = 'Input records';
    source.config.data_format = 'structure';
    source.description = 'columns: id integer, name text';
    const processor = NODE_KINDS.code.create('processor');
    const target = NODE_KINDS.data.create('target');
    target.label = 'Result map';
    target.config.data_format = 'structure';
    const nodes = [source, processor, target];
    const wires = [edge('source', 'processor'), edge('processor', 'target')];

    expect(inputSources('processor', nodes, wires, true).input)
      .toContain('"Input records" (port "Value"), which hands on: Persisted value; structure: columns: id integer, name text');
    expect(outputTargets('processor', nodes, wires, true).output).toContain('"Result map" (port "Update"), which wants what it stores: structure');
  });

  it('describes a non-data upstream node too', () => {
    // The old version considered `data` nodes only, so this -- the commonest
    // wiring there is -- produced no context at all.
    const input = NODE_KINDS.input.create('src');
    input.label = 'Reports folder';
    input.config.input_mode = 'directory';
    const code = NODE_KINDS.code.create('worker');

    expect(inputSources('worker', [input, code], [edge('src', 'worker')], true).input)
      .toContain('port "Files" carries a list of file paths');
  });

  it('carries an upstream ai node\'s output definition', () => {
    const ai = NODE_KINDS.ai.create('classifier');
    ai.label = 'Classifier';
    ai.config.output_definition = 'module.exports = { "label": "spam" };';
    const code = NODE_KINDS.code.create('worker');

    expect(inputSources('worker', [ai, code], [edge('classifier', 'worker')], true).input)
      .toContain('what its output.js defines:\nmodule.exports = { "label": "spam" };');
  });

  it('is empty for an unconnected node rather than noise', () => {
    const code = NODE_KINDS.code.create('lonely');
    expect(inputSources('lonely', [code], [], true)).toEqual({});
    expect(outputTargets('lonely', [code], [], true)).toEqual({});
  });
});

describe('describeNodeOutput', () => {
  it('distinguishes the input node modes', () => {
    const node = NODE_KINDS.input.create('i');
    node.config.input_mode = 'directory';
    expect(describeNodeOutput(node)).toContain('port "Files" carries a list of file paths');
    node.config.input_mode = 'text';
    expect(describeNodeOutput(node)).toBe('text');
  });

  it('describes a code or an ai node by its output.js -- an ai node without one hands on its answer', () => {
    const code = NODE_KINDS.code.create('c');
    code.config.output_definition = 'module.exports = { "rows": [] };';
    expect(describeNodeOutput(code)).toBe('what its output.js defines:\nmodule.exports = { "rows": [] };');
    expect(describeNodeOutput(NODE_KINDS.code.create('c'))).toBe('');
    expect(describeNodeOutput(NODE_KINDS.ai.create('a'))).toBe('the model\'s answer, as text');
  });
});

describe('what a node received on the last run', () => {
  const resultWith = (inputs: Record<string, unknown>): ExecutionResult => ({
    status: 'success',
    node_results: [{ node_id: 'worker', status: 'success', inputs, outputs: {} }],
    outputs: {},
  } as ExecutionResult);

  it('is what arrived on each input, as it arrived', () => {
    expect(lastRunInputs('worker', resultWith({ rows: [{ id: 1 }, { id: 2 }] }))).toEqual({ rows: [{ id: 1 }, { id: 2 }] });
  });

  it('is nothing before the first run, or for another node', () => {
    expect(lastRunInputs('worker', null)).toBeUndefined();
    expect(lastRunInputs('someone-else', resultWith({ a: 1 }))).toBeUndefined();
    expect(lastRunInputs('worker', resultWith({}))).toBeUndefined();
  });
});

describe('a node that is handed the text of a file', () => {
  const reader = () => {
    const node = NODE_KINDS.code.create('worker');
    node.inputs = [
      { id: 'csv', name: 'CSV', kind: 'input', data_type: 'file_path', multi: false, required: false },
      { id: 'top', name: 'Top', kind: 'input', data_type: 'text', multi: false, required: false },
    ] as typeof node.inputs;
    return node;
  };

  it('names the ports the server must read before it tries generated code on the sample: the ones ticked to read', () => {
    expect(readFilePorts(reader())).toEqual(['csv']);
    // A kind that takes a path as a path reads nothing, whatever its ports say.
    const out = NODE_KINDS.output.create('sink');
    expect(out.inputs.some((port) => port.data_type === 'file_path')).toBe(true);
    expect(readFilePorts(out)).toEqual([]);
  });

  it('never reads an input that did not say so, however it is wired', () => {
    // The wire used to decide for a port typed `any`: a sentence wired in from
    // somewhere that declared a path became "no such file".
    const node = NODE_KINDS.code.create('worker');
    expect(node.inputs[0].data_type).toBe('any');
    expect(readFilePorts(node)).toEqual([]);
  });

  it('keeps the path a run recorded on the port it read, which is the file ✨ Input may write from', () => {
    const result = {
      status: 'success', outputs: {},
      node_results: [{ node_id: 'worker', status: 'success', inputs: { csv: 'data/people.csv', top: '5' }, outputs: {} }],
    } as ExecutionResult;
    expect(lastRunInputs('worker', result)?.csv).toBe('data/people.csv');
    expect(readFilePorts(reader())).toEqual(['csv']);
  });
});

describe('duplicate neighbours', () => {
  it('states a shared neighbour once, not once per wire', () => {
    // Two wires into the same port of the same node are two edges and one fact.
    const code = NODE_KINDS.code.create('worker');
    const out = NODE_KINDS.output.create('sink');
    out.label = 'Result';
    const wire = { source: 'worker', sourceHandle: 'output', target: 'sink', targetHandle: 'value' };

    expect(outputTargets('worker', [code, out], [wire, { ...wire }], true).output)
      .toBe('"Result" (port "Value"), which wants the run\'s result');
  });
});

describe('what an output node wants', () => {
  it('tells the node feeding it what the result is and where it goes, not only its port\'s own words', () => {
    // A new output node's value port says nothing, so the node wired into it
    // was written for nothing in particular.
    const out = NODE_KINDS.output.create('sink');
    out.label = 'Table';
    out.description = 'One row per country';
    out.config.write_mode = 'file';
    out.config.value = 'out/table.csv';
    const code = NODE_KINDS.code.create('worker');

    const targets = outputTargets('worker', [code, out], [
      { source: 'worker', sourceHandle: 'output', target: 'sink', targetHandle: 'value' },
    ], true);
    expect(targets.output).toContain('One row per country');
    expect(targets.output).toContain('written to the file "out/table.csv"');
  });
});

describe('what a node is wired to, as the panel and ✨ say it', () => {
  it('names where each output goes, node and port', () => {
    const code = NODE_KINDS.code.create('worker');
    const out = NODE_KINDS.output.create('shown');
    out.label = 'Report';
    const targets = outputTargets('worker', [code, out], [
      { source: 'worker', target: 'shown', sourceHandle: 'output', targetHandle: 'value' },
    ]);
    expect(targets).toEqual({ output: '"Report" (port "Value")' });
  });

  it('names what feeds each input -- plainly for the panel, with what it hands on for ✨', () => {
    const ai = NODE_KINDS.ai.create('writer');
    ai.label = 'Writer';
    ai.config.output_definition = 'module.exports = { "output": "one short paragraph" };';
    const code = NODE_KINDS.code.create('worker');
    const wires = [{ source: 'writer', target: 'worker', sourceHandle: 'output', targetHandle: 'input' }];
    expect(inputSources('worker', [ai, code], wires)).toEqual({ input: '"Writer" (port "Output")' });
    expect(inputSources('worker', [ai, code], wires, true).input)
      .toMatch(/^"Writer" \(port "Output"\), which hands on: [^]*one short paragraph/);
  });

  it('tells a node feeding a chart block what the chart wants -- the block says it', () => {
    const code = NODE_KINDS.code.create('worker');
    const page = NODE_KINDS.gui.create('page');
    page.label = 'Dashboard';
    page.config.gui_widgets = [{ id: 'w1', kind: 'plot_window', label: 'Sizes' } as never];
    const told = outputTargets('worker', [code, page], [
      { source: 'worker', sourceHandle: 'output', target: 'page', targetHandle: 'w1_in' },
    ], true);
    expect(told.output).toContain('"Dashboard"');
    expect(told.output).toContain('{"kind": "bars"|"columns"|"line"|"donut"');
  });
});

describe('a new node', () => {
  it('starts with no description, so ✨ on a fresh ai or code node has nothing to invent code for', () => {
    expect(NODE_KINDS.ai.create('a').description).toBe('');
    expect(NODE_KINDS.code.create('c').description).toBe('');
  });
});

describe('what ✨ is told of a node wired on both sides', () => {
  it('says what each wire carries and what the node at the other end wants', () => {
    const input = NODE_KINDS.input.create('src');
    input.label = 'Notes';
    const code = NODE_KINDS.code.create('worker');
    const page = NODE_KINDS.gui.create('page');
    page.label = 'Dashboard';
    page.config.gui_widgets = [{ id: 'w1', kind: 'table', label: 'Findings' } as never];
    const edges = [
      { id: 'a', source: 'src', target: 'worker', sourceHandle: input.outputs[0].id, targetHandle: 'input' },
      { id: 'b', source: 'worker', target: 'page', sourceHandle: 'output', targetHandle: 'w1_in' },
    ];
    expect(inputSources('worker', [input, code, page], edges, true).input).toMatch(/^"Notes" \(port "[^"]+"\), which hands on: /);
    expect(outputTargets('worker', [input, code, page], edges, true).output).toContain('which wants rows: a list of objects');
  });
});
