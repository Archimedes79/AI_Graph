import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { connectedFormatContext, lastRunContext, describeNodeOutput, inputSources, outputTargets, pathPorts, readFilePorts } from './generationContext';
import type { ExecutionResult } from '@/graph';
import { nodeFacts } from './nodeFacts';
import { NODE_BUILDERS } from '@/elements/registry';

const edge = (source: string, target: string) => ({ source, target });

describe('connectedFormatContext', () => {
  it('still describes data nodes on both sides, in the wording prompts were tuned to', () => {
    const source = NODE_KINDS.data.create('source');
    source.label = 'Input records';
    source.config.data_format = 'structure';
    source.config.data_format_prompt = 'columns: id integer, name text';
    const processor = NODE_KINDS.code.create('processor');
    const target = NODE_KINDS.data.create('target');
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
    const input = NODE_KINDS.input.create('src');
    input.label = 'Reports folder';
    input.config.input_mode = 'directory';
    const code = NODE_KINDS.code.create('worker');

    const context = connectedFormatContext('worker', [input, code], [edge('src', 'worker')]);

    expect(context).toContain('Input from "Reports folder" (input node): port "Files" carries a list of file paths');
  });

  it('carries an upstream ai node\'s declared output format', () => {
    const ai = NODE_KINDS.ai.create('classifier');
    ai.label = 'Classifier';
    ai.config.output_format = 'json';
    const code = NODE_KINDS.code.create('worker');

    const context = connectedFormatContext('worker', [ai, code], [edge('classifier', 'worker')]);
    expect(context).toContain('Input from "Classifier" (ai node): Respond with JSON and nothing else.');
  });

  it('is empty for an unconnected node rather than noise', () => {
    const code = NODE_KINDS.code.create('lonely');
    expect(connectedFormatContext('lonely', [code], [])).toBe('');
  });
});

describe('describeNodeOutput', () => {
  it('distinguishes the input node modes', () => {
    const node = NODE_KINDS.input.create('i');
    node.config.input_mode = 'file';
    expect(describeNodeOutput(node)).toContain('port "Content" carries the file');
    node.config.input_mode = 'text';
    expect(describeNodeOutput(node)).toBe('text');
  });

  it('describes a code node by its output interface once a run has set one', () => {
    const node = NODE_KINDS.code.create('c');
    node.config.output_schema = { type: 'object', properties: { rows: { type: 'array' } } };
    expect(describeNodeOutput(node)).toBe(
      'returns { rows: list of anything }',
    );
  });

  it('spells out a custom output format', () => {
    const node = NODE_KINDS.code.create('c');
    node.config.output_format = 'custom';
    node.config.output_format_prompt = 'one line per finding';
    expect(describeNodeOutput(node)).toBe('one line per finding');
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

describe('a node that is handed the text of a file', () => {
  const reader = () => {
    const node = NODE_KINDS.code.create('worker');
    node.inputs = [
      { id: 'csv', name: 'CSV', kind: 'input', data_type: 'file_path', multi: false, required: false },
      { id: 'top', name: 'Top', kind: 'input', data_type: 'text', multi: false, required: false },
    ] as typeof node.inputs;
    node.config.read_file_inputs = true;
    return node;
  };

  it('names the ports the server must read before it tries generated code on the sample', () => {
    const node = reader();
    expect(readFilePorts(node)).toEqual(['csv']);
    node.config.read_file_inputs = false;
    expect(readFilePorts(node)).toEqual([]);
  });

  it('asks with the wiring, as the run does: an input that says nothing, wired from a path, is read', () => {
    // A graph written by hand, by the MCP server or by a model keeps the port
    // `any`; the run reads it, and ✨ was told a path and tried code on a filename.
    const node = NODE_KINDS.code.create('worker');
    node.config.read_file_inputs = true;
    const source = NODE_KINDS.input.create('file');
    source.config.input_mode = 'file';
    source.outputs = [{ id: 'path', name: 'Path', kind: 'output', data_type: 'file_path', multi: false, required: false, description: '' }];
    const wired = [{ source: 'file', sourceHandle: 'path', target: 'worker', targetHandle: 'input' }];
    expect(node.inputs[0].data_type).toBe('any');
    expect(readFilePorts(node, [source, node], wired)).toEqual(['input']);
    expect(readFilePorts(node)).toEqual([]);
  });

  it('knows a path arrives on a port whether or not the node reads it: a file picked as its example is kept as a path', () => {
    const node = reader();
    node.config.read_file_inputs = false;
    expect(readFilePorts(node)).toEqual([]);
    expect(pathPorts(node)).toEqual(['csv']);
  });

  it('does not quote the recorded path as the value the code will receive', () => {
    const result = {
      status: 'success', outputs: {},
      node_results: [{ node_id: 'worker', status: 'success', inputs: { csv: 'data/people.csv', top: '5' }, outputs: {} }],
    } as ExecutionResult;
    const context = lastRunContext('worker', result, readFilePorts(reader()));
    expect(context).not.toContain('people.csv');
    expect(context).toContain('- csv: the text of one file, already read');
    expect(context).toContain('- top (string)');
  });
});

describe('duplicate neighbours', () => {
  it('states a shared neighbour once, not once per wire', () => {
    // Two output ports into the same Output node is two edges and one fact.
    const code = NODE_KINDS.code.create('worker');
    const out = NODE_KINDS.output.create('sink');
    out.label = 'Result';

    const context = connectedFormatContext('worker', [code, out], [
      edge('worker', 'sink'), edge('worker', 'sink'),
    ]);

    expect(context).toBe('Output goes to "Result" (output node): shown as text in a window.');
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

describe('what a node is wired to, as the dialog and ✨ say it', () => {
  it('names where each output goes, node and port', () => {
    const code = NODE_KINDS.code.create('worker');
    const out = NODE_KINDS.output.create('shown');
    out.label = 'Report';
    const targets = outputTargets('worker', [code, out], [
      { source: 'worker', target: 'shown', sourceHandle: 'output', targetHandle: 'value' },
    ]);
    expect(targets).toEqual({ output: '"Report" (port "Value")' });
  });

  it('names what feeds each input -- plainly for the dialog, with what it hands on for ✨', () => {
    const ai = NODE_KINDS.ai.create('writer');
    ai.label = 'Writer';
    ai.config.output_format_prompt = 'one short paragraph';
    const code = NODE_KINDS.code.create('worker');
    const wires = [{ source: 'writer', target: 'worker', sourceHandle: 'output', targetHandle: 'input' }];
    expect(inputSources('worker', [ai, code], wires)).toEqual({ input: '"Writer" (port "Output")' });
    expect(inputSources('worker', [ai, code], wires, true).input)
      .toMatch(/^"Writer" \(port "Output"\), which hands on: .*one short paragraph/);
  });

  it('tells a node feeding a chart block what the chart wants -- the block says it', () => {
    const code = NODE_KINDS.code.create('worker');
    const page = NODE_KINDS.gui.create('page');
    page.label = 'Dashboard';
    page.config.gui_widgets = [{ id: 'w1', kind: 'plot_window', label: 'Sizes' } as never];
    const context = connectedFormatContext('worker', [code, page], [
      { source: 'worker', target: 'page', targetHandle: 'w1_in' },
    ]);
    expect(context).toContain('the "Sizes" block (plot_window) on the page "Dashboard"');
    expect(context).toContain('NOT a drawing');
  });

  it('says a read file arrives as text for any node, not only as a function signature', () => {
    const result = { node_results: [{ node_id: 'n', inputs: { doc: 'a.txt' } }] } as unknown as ExecutionResult;
    const text = lastRunContext('n', result, ['doc']);
    expect(text).toContain('the text of one file, already read');
    expect(text).not.toContain('signature');
  });
});

describe('a new node', () => {
  it('starts with no description, so ✨ on a fresh ai or code node has nothing to invent code for', () => {
    expect(NODE_KINDS.ai.create('a').description).toBe('');
    expect(NODE_KINDS.code.create('c').description).toBe('');
  });
});

describe('what ✨ is told about a node, as facts', () => {
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
    const facts = nodeFacts(code, [input, code, page], edges as never, null);
    expect(facts.inputSources?.input).toMatch(/^"Notes" \(port "[^"]+"\), which hands on: /);
    expect(facts.outputTargets?.output).toContain('which wants rows: a list of objects');
    expect(facts.inputTypes).toEqual({ input: 'any' });
    expect(facts.batchMode).toBe('per_item');
  });

  it('sends the format in words, as a run reads them: under a kept example an older picked format says nothing', () => {
    const code = NODE_KINDS.code.create('worker');
    code.config.output_format = 'json';
    code.config.output_format_prompt = 'a list of {title, score}';
    code.config.output_example = '[{"title": "a", "score": 1}]';
    const facts = nodeFacts(code, [code], [], null);
    expect(facts.outputFormat).toBe('a list of {title, score}');
    expect(facts.outputExample).toBe('[{"title": "a", "score": 1}]');
    code.config.output_example = '';
    expect(nodeFacts(code, [code], [], null).outputFormat).toBe('Respond with JSON and nothing else.\n\na list of {title, score}');
  });

  it('takes step 1\'s example as the sample, over what the last run delivered', () => {
    const code = NODE_KINDS.code.create('worker');
    code.config.examples = '## Mine\n\n```json input\n{"input": "typed"}\n```\n';
    const ran = { status: 'success', outputs: {}, node_results: [{ node_id: 'worker', status: 'success', inputs: { input: 'last run' }, outputs: {} }] } as ExecutionResult;
    const facts = nodeFacts(code, [code], [], ran);
    expect(facts.sampleInputs).toEqual({ input: 'typed' });
    expect(facts.sampleOrigin).toBe('the example in step 1');
    // An example the engine reads in full, with what it expects, is left to it.
    code.config.examples = '## Mine\n\n```json input\n{"input": "typed"}\n```\n\n```json expect\n{}\n```\n';
    expect(nodeFacts(code, [code], [], ran).sampleInputs).toBeUndefined();
  });

  it('shows a node fed by a file input that file, read as a run reads it, before the graph has run', () => {
    // A file input's example file and its "what these files contain" reached
    // no generation downstream; its file now does, as a path the engine reads.
    const input = NODE_KINDS.input.create('src');
    input.config.input_mode = 'file';
    input.config.value = 'data/people.csv';
    input.outputs = [
      { id: 'content', name: 'Content', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
      { id: 'path', name: 'Path', kind: 'output', data_type: 'file_path', multi: false, required: false, description: '' },
    ];
    const code = NODE_KINDS.code.create('worker');
    const facts = nodeFacts(code, [input, code], [{ id: 'a', source: 'src', target: 'worker', sourceHandle: 'content', targetHandle: 'input' }] as never, null);
    expect(facts.sampleInputs).toEqual({ input: 'data/people.csv' });
    expect(facts.readFilePorts).toEqual(['input']);
  });
});

describe('a folder input\'s selector, as ✨ is told it', () => {
  it('is told what the files hold as what they hold, not as the format of what it returns (B20)', () => {
    // An older dialog let a person say what the files contain. The selector
    // returns a list of paths, which its contract says; the words went out as
    // its "Format", so it was told it returns CSV.
    const folder = NODE_KINDS.input.create('folder');
    folder.config = { ...folder.config, input_mode: 'directory', select_all_files: false, output_format_prompt: 'UTF-8 CSV, columns: date, amount' };
    expect(nodeFacts(folder, [folder], [], null).outputFormat).toBe('');
    expect(NODE_BUILDERS.input.generation?.context?.(folder)).toBe('The files in this folder contain: UTF-8 CSV, columns: date, amount');
  });
});
