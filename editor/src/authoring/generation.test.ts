import { describe, it, expect } from 'vitest';
import type { GraphNode, Port } from '@/graph';
import type { ProbeReport } from '@/api/client';
import { NODE_KINDS } from '@/document/nodeKinds';
import {
  exchangeName, generateRequest, generationGuard, isWritten, outputsFrom, resultMessage, unfitDefinition, writeName, writesFor, writtenInto,
} from './generation';

/**
 * What a node's ✨ asks and what it writes in: the request built in one place
 * for the panel, the sweep and "what ✨ sends", and the answer written into
 * the node by one pure function.
 */

/** A new node of *type*, with *config* set on top of what it starts with. */
function made(type: 'code' | 'ai' | 'data', config: Record<string, unknown> = {}, inputs?: Port[]): GraphNode {
  const node = NODE_KINDS[type].create(type);
  return { ...node, inputs: inputs ?? node.inputs, config: { ...node.config, ...config } };
}

const INPUT = 'module.exports = { "input": "a" };';
const OUTPUT = 'module.exports = { "output": 1 };';
const answer = (result: string, description?: string) => ({ result, calls: [], ...(description === undefined ? {} : { description }) });
const around = (node: GraphNode) => ({ nodes: [node], edges: [], metadata: { name: 'Words', description: '', gui_scheme: 'night' } as never });

describe('what one press of ✨ writes', () => {
  it('is, for the body, what is missing first -- input.js where it takes something in, output.js -- so one press does the whole node', () => {
    expect(writesFor(made('code'), 'body')).toEqual(['input', 'output', 'body']);
    expect(writesFor(made('code', { input_definition: INPUT }), 'body')).toEqual(['output', 'body']);
    expect(writesFor(made('code', { input_definition: INPUT, output_definition: OUTPUT }), 'body')).toEqual(['body']);
    expect(writesFor(made('code', {}, []), 'body')).toEqual(['output', 'body']);
    // A stub is nothing written.
    expect(writesFor(made('ai', { input_definition: 'module.exports = null;' }), 'body')).toEqual(['input', 'output', 'body']);
  });

  it('is only itself for ✨ Input and ✨ Output, and for a data node, which has no definitions', () => {
    expect(writesFor(made('code'), 'input')).toEqual(['input']);
    expect(writesFor(made('code'), 'output')).toEqual(['output']);
    expect(writesFor(made('data'), 'body')).toEqual(['body']);
  });

  it('is named on its button, in a message and in history.md -- a change and a fix by what they were', () => {
    expect(['input', 'output', 'body'].map((write) => writeName(made('code'), write as never))).toEqual(['✨ Input', '✨ Output', '✨ Code']);
    expect(writeName(made('ai'), 'body')).toBe('✨ Prompt');
    expect(writeName(made('data'), 'body')).toBe('✨ Data');
    expect(exchangeName(made('code'), 'body', { change: '  also count the words ' })).toBe('Change: also count the words');
    expect(exchangeName(made('code'), 'body', { error: 'x is not defined' })).toBe('✨ Fix');
  });

  it('waits for the node\'s text: everything is written from it', () => {
    expect(generationGuard(made('code'))).toMatch(/Say what this node should do first/);
    expect(generationGuard({ ...made('code'), description: 'Count the words.' })).toBeUndefined();
  });
});

describe('what ✨ sends', () => {
  it('is the node without its history, the graph around it, what it is wired to -- and the files each ✨ is given', () => {
    const node = { ...made('code', { history: '## old', input_files: ['data/a.csv'], output_files: ['spec.md'] }), description: 'Count.' };
    const input = generateRequest(node, 'input', around(node), ['data/a.csv', 'data/b.csv']);
    expect(input.node.config.history).toBeUndefined();
    expect(input.context).toContain('Graph: Words');
    expect(input.input_files).toEqual([{ path: 'data/a.csv' }, { path: 'data/b.csv' }]);
    expect(input.output_files).toBeUndefined();
    const output = generateRequest(node, 'output', around(node), ['data/a.csv']);
    expect(output.output_files).toEqual([{ path: 'spec.md' }]);
    expect(output.input_files).toBeUndefined();
    const body = generateRequest(node, 'body', around(node), ['data/a.csv'], { change: 'shout' });
    expect(body).toMatchObject({ write: 'body', refine: { change: 'shout' }, input_sources: {}, output_targets: {} });
    expect(body.input_files).toBeUndefined();
  });
});

describe('what comes back, written in', () => {
  const at = new Date(2026, 8, 28, 9, 30);

  it('is the file ✨ wrote, and the exchange at the end of history.md', () => {
    const node = made('code');
    const input = writtenInto(node, 'input', answer(INPUT), '✨ Input', at);
    expect(input.config.input_definition).toBe(INPUT);
    expect(input.config.history).toBe('## 2026-09-28 09:30 · ✨ Input\n\nNothing was sent.');
    expect(input.outputs).toBe(node.outputs);
    expect(writtenInto(node, 'body', answer('function run() { return { output: 1 }; }'), '✨ Code', at).config.code)
      .toBe('function run() { return { output: 1 }; }');
  });

  it('is, for an output definition, the outputs too: its example\'s keys are the node\'s outputs', () => {
    const written = writtenInto(made('code', {}, []), 'output', answer('module.exports = { "rows": [], "count": 2, "title": "t" };'), '✨ Output', at);
    expect(written.outputs.map((port) => [port.id, port.data_type])).toEqual([['rows', 'list'], ['count', 'number'], ['title', 'text']]);
  });

  it('is what a data node holds, as what it is: structure parsed, text as it is', () => {
    const structure = made('data', { data_format: 'structure' });
    expect(writtenInto(structure, 'body', answer('{ "count": 3 }'), '✨ Data', at).config.data_value).toEqual({ count: 3 });
    expect(writtenInto(made('data'), 'body', answer('three'), '✨ Data', at).config.data_value).toBe('three');
  });

  it('restates the node\'s text where a change was asked, and leaves it where nothing came back for it', () => {
    const node = { ...made('code'), description: 'Count the words.' };
    expect(writtenInto(node, 'body', answer('x', '  Count the words, and the lines. '), 'Change: lines', at).description).toBe('Count the words, and the lines.');
    expect(writtenInto(node, 'body', answer('x', '  '), '✨ Code', at).description).toBe('Count the words.');
  });

  it('says whether the file is written: its stub is not', () => {
    expect(isWritten(made('code'), 'input')).toBe(false);
    expect(isWritten(made('code', { input_definition: 'module.exports = null;' }), 'input')).toBe(false);
    expect(isWritten(made('code', { input_definition: INPUT }), 'input')).toBe(true);
    expect(isWritten(made('data', { data_value: { count: 1 } }), 'body')).toBe(true);
    expect(isWritten(made('data'), 'body')).toBe(false);
  });
});

describe('the outputs an output definition names', () => {
  const port = (id: string, extra: Partial<Port> = {}): Port => ({ id, name: id.toUpperCase(), kind: 'output', data_type: 'text', multi: false, required: false, description: 'kept', ...extra });

  it('keeps a port that is there as it is, types a new one by its example, and keeps the error port last', () => {
    const node = { ...made('code', {}, []), outputs: [port('summary'), port('error')] };
    const outputs = outputsFrom(node, 'module.exports = { "flag": true, "summary": "s", "parts": { "a": 1 } };');
    expect(outputs.map((one) => [one.id, one.data_type, one.name])).toEqual([
      ['flag', 'boolean', 'flag'], ['summary', 'text', 'SUMMARY'], ['parts', 'json', 'parts'], ['error', 'text', 'ERROR'],
    ]);
  });

  it('hands on a list from a new port where the node runs once per item', () => {
    const perItem = made('code');
    expect(perItem.config.batch_mode).toBe('per_item');
    expect(outputsFrom(perItem, OUTPUT)[0].multi).toBe(true);
    expect(outputsFrom(made('code', { batch_mode: 'whole_list' }), 'module.exports = { "total": 1 };')[0].multi).toBe(false);
  });

  it('leaves the outputs alone for a definition without an example -- a stub, or one that cannot be read', () => {
    const node = made('code');
    expect(outputsFrom(node, 'module.exports = null;')).toBe(node.outputs);
    expect(outputsFrom(node, 'module.exports = { oops')).toBe(node.outputs);
  });
});

describe('what is said once ✨ is done', () => {
  const probe = (status: ProbeReport['status'], error = '', problems: string[] = []) => ({ probe: { status, error, problems } });

  it('says it was written, and how the try on the example went', () => {
    expect(resultMessage('✨ Code', probe('ok'))).toBe('✅ ✨ Code: written, and it fits output.js on the example in input.js.');
    expect(resultMessage('✨ Code', probe('repaired'), { change: 'Add one.' })).toMatch(/^✅ ✨ Code: changed\. The first attempt did not fit/);
    expect(resultMessage('✨ Code', probe('failed', 'boom'))).toBe('⚠️ ✨ Code: written, but it fails on the example in input.js: boom');
    expect(resultMessage('✨ Code', probe('failed', '', ['"count" is missing']))).toBe('⚠️ ✨ Code: written, but "count" is missing');
    expect(resultMessage('✨ Input', probe('skipped'))).toBe('✅ ✨ Input: written.');
  });

  it('says what ✨ Fix came to -- repaired, or still not -- rather than that code was written', () => {
    const fix = { error: 'x is not defined' };
    expect(resultMessage('✨ Code', probe('repaired'), fix)).toBe('✅ ✨ Fix: repaired, and it fits output.js on the example in input.js.');
    expect(resultMessage('✨ Code', probe('ok'), fix)).toBe('✅ ✨ Fix: repaired, and it fits output.js on the example in input.js.');
    expect(resultMessage('✨ Code', probe('failed', '', ['Output "output" is a number; output.js says a list']), fix))
      .toBe('⚠️ ✨ Fix: still does not fit -- output "output" is a number; output.js says a list');
    expect(resultMessage('✨ Code', probe('failed', 'boom'), fix)).toBe('⚠️ ✨ Fix: it still fails on the example in input.js: boom');
    expect(resultMessage('✨ Prompt', probe('skipped'), fix)).toBe('✅ ✨ Fix: written again. ▶ Try tries it.');
  });

  it('stops a press at a definition that does not fit the node: what comes after would be written against it', () => {
    const names = { status: 'failed' as const, error: '', problems: ['It names "text", which is not among the inputs: "input".'] };
    expect(unfitDefinition('input', names)).toBe('it names "text", which is not among the inputs: "input".');
    expect(resultMessage('✨ Input', { probe: names })).toBe('⚠️ ✨ Input: written, but it names "text", which is not among the inputs: "input".');
    expect(unfitDefinition('output', { status: 'skipped', error: '', problems: [] })).toBeUndefined();
    // A body that fails its try is written and said: nothing comes after it.
    expect(unfitDefinition('body', { status: 'failed', error: 'boom', problems: [] })).toBeUndefined();
  });
});
