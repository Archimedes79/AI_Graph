import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiRequest, AiService, CodeService } from '../../elements/Runtime.ts';
import { registry } from '../../elements/registry.ts';
import { GenerationFailed, GenerationRefused, generate, generateGraph, withContextFile } from './generate.ts';
import { nodeCode } from '../node.ts';

/**
 * Writing a body with a model, without a model.
 *
 * The model is a script here: it answers each call in turn, so a test can say
 * exactly what the first and the second pass returned. The runner is the real
 * sandbox for the probes that matter, and a fake where only the verdict does.
 */

function scripted(replies: string[]): AiService & { asked: AiRequest[] } {
  const asked: AiRequest[] = [];
  return {
    asked,
    async complete(request) {
      asked.push(request);
      const reply = replies.shift();
      if (reply === undefined) throw new Error('the model was asked more than it was scripted for');
      return reply;
    },
  };
}

const runner = (outcome: (body: string) => Record<string, unknown>): CodeService => ({
  run: async (body) => outcome(body),
});

const generationFor = (name: string) => registry.node(name)?.generation() ?? registry.widget(name)?.generation();
const target = { provider: 'test', model: 'm' };

describe('code', () => {
  it('asks for a function against the skeleton, and keeps what came back in the fence', async () => {
    const ai = scripted(['```javascript\nfunction run(inputs) { return { out: 1 }; }\n```\nIt adds.']);
    const reply = await generate(
      { element: 'code', description: 'add', inputs: ['a'], outputs: ['out'] },
      { ai, code: runner(() => ({})), generationFor, target },
    );
    expect(reply.result).toBe('function run(inputs) { return { out: 1 }; }');
    expect(reply.explanation).toBe('It adds.');
    expect(reply.probe.status).toBe('skipped');                 // no sample, one honest pass
    expect(ai.asked[0].prompt).toContain('function run(inputs) {');
    expect(ai.asked[0].prompt).toContain('const a = inputs["a"];');
    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]).toMatchObject({ provider: 'test', model: 'm', reply_chars: expect.any(Number) });
  });

  it('verifies against the sample and reports what the code returned, whole', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { out: i.a * 2 }; }\n```']);
    const reply = await generate(
      { element: 'code', description: 'double', inputs: ['a'], outputs: ['out'], sample_inputs: { a: 21 } },
      { ai, code: runner(() => ({ out: 42 })), generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'ok', attempts: 1, output_preview: '{"out":42}', outputs: { out: 42 } });
  });

  it('repairs once with the evidence when the first attempt misses a key', async () => {
    const ai = scripted([
      '```js\nfunction run(i) { return { wrong: 1 }; }\n```',
      '```js\nfunction run(i) { return { out: 1 }; }\n```',
    ]);
    const reply = await generate(
      { element: 'code', description: 'x', outputs: ['out'], sample_inputs: { a: 1 } },
      { ai, code: runner((body) => (body.includes('wrong') ? { wrong: 1 } : { out: 1 })), generationFor, target },
    );
    expect(reply.probe.status).toBe('repaired');
    expect(reply.probe.attempts).toBe(2);
    expect(reply.result).toContain('out: 1');
    expect(ai.asked[1].prompt).toContain('--- wrong result keys ---');
    expect(ai.asked[1].prompt).toContain('missing ["out"]');
  });

  it('keeps the attempt that got further when the repair is no better, and says what remains', async () => {
    const ai = scripted([
      '```js\nfunction run(i) { return { wrong: 1 }; }\n```',
      '```js\nfunction run(i) { throw new Error("boom"); }\n```',
    ]);
    const reply = await generate(
      { element: 'code', description: 'x', outputs: ['out'], sample_inputs: { a: 1 } },
      { ai, code: runner((body) => { if (body.includes('boom')) throw new Error('boom'); return { wrong: 1 }; }), generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'failed', missing_outputs: ['out'] });
    expect(reply.result).toContain('wrong: 1');
  });

  it('generates a fixed-port snippet against its own ports, never probing the node\'s sample', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { value: [] }; }\n```']);
    let probed = false;
    const reply = await generate(
      { element: 'plot_window', description: 'chart it', inputs: ['text'], outputs: ['result'], sample_inputs: { text: 'x' } },
      { ai, code: runner(() => { probed = true; return {}; }), generationFor, target },
    );
    expect(probed).toBe(false);
    expect(reply.probe.status).toBe('skipped');
    expect(ai.asked[0].prompt).toContain('inputs["value"]');
    expect(ai.asked[0].prompt).toContain('Must expose draw(data, window)');    // the block's own contract, first
  });
});

describe('generated code that asks a model', () => {
  it('is tried the way a graph runs it: with a node it can ask -- it used to fail on `node.llm is not a function`', async () => {
    // First reply: the code. Second: what the code's own question is answered with, in the probe.
    const ai = scripted([
      '```js\nasync function run(inputs, node) { return { label: (await node.llm({ prompt: "Classify: " + inputs.row })).trim() }; }\n```',
      ' fruit ',
    ]);
    const reply = await generate(
      { element: 'code', description: 'classify the row with the model', inputs: ['row'], outputs: ['label'], sample_inputs: { row: 'apple' } },
      { ai, code: nodeCode, generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'ok', attempts: 1, outputs: { label: 'fruit' } });
    expect(ai.asked[1].prompt).toContain('Classify: apple');
  }, 30_000);
});

describe('what the node says about itself reaches the model', () => {
  // The port descriptions, the kept output shape and the examples were used to
  // check a body and never to write one; pressing ✨ again could rename a
  // table's columns with every check still passing.
  const rows = {
    element: 'code', description: 'One table row per file.',
    inputs: ['files', 'summaries'], outputs: ['rows'],
    input_notes: { files: 'Every path in the folder', summaries: 'One per file, same order' },
    output_notes: { rows: 'A list of {File, Summary}' },
    output_schema: { type: 'object', properties: { rows: { type: 'array' } }, required: ['rows'] },
    examples: '## Two files\n\n```json input\n{"files": ["a.txt"], "summaries": ["One."]}\n```\n\n```json expect\n{"rows": [{"File": "a.txt", "Summary": "One."}]}\n```\n',
  };

  it('says each input once -- what it holds, where from, a sample -- and the output, shape and examples after', async () => {
    const ai = scripted(['```js\nfunction run() { return { rows: [] }; }\n```']);
    await generate(rows, { ai, code: runner(() => ({ rows: [{ File: 'a.txt', Summary: 'One.' }] })), generationFor, target });
    const prompt = ai.asked[0].prompt;
    expect(prompt).toContain('## What comes in\n- `files`: Every path in the folder');
    // No run yet: the example's inputs are the sample, and say so.
    expect(prompt).toContain('sample, from the example "Two files": a list of 1: ["a.txt"]');
    expect(prompt).toContain('## What goes out\n- `rows`: A list of {File, Summary}');
    expect(prompt).toContain('keep it: { rows: list of anything }');
    expect(prompt).toContain('must return, at least: {"rows":[{"File":"a.txt","Summary":"One."}]}');
    // Said once: the skeleton is the signature, typed from the sample, with no second copy of the notes.
    expect(prompt).toContain('@property {string[]} files\n');
    expect(prompt.split('Every path in the folder')).toHaveLength(2);
  });

  it('sends the output format and an example whatever else is set, cut to a budget', async () => {
    const ai = scripted(['```js\nfunction run() { return { rows: [] }; }\n```']);
    await generate({
      ...rows, examples: undefined, output_format: 'A list of {File, Summary}, largest first.',
      output_example: '[{"File": "b.txt", "Summary": "Two."}]',
      sample_inputs: { files: ['x'.repeat(5000)], summaries: ['y'] },
    }, { ai, code: runner(() => ({ rows: [] })), generationFor, target });
    const prompt = ai.asked[0].prompt;
    expect(prompt).toContain('Format: A list of {File, Summary}, largest first.');
    expect(prompt).toContain('the same structure, new content:\n[{"File": "b.txt"');
    expect(prompt).toContain('sample, from the last run: a list of 1: ["xxx');
    expect(prompt).toContain('more characters not shown');
    expect(prompt.length).toBeLessThan(6000);
  });

  it('holds the code to the example it was tried on, and repairs it when it falls short', async () => {
    const ai = scripted([
      '```js\nfunction run() { return { rows: [] }; }\n```',
      '```js\nfunction run() { return { rows: [{ File: "a.txt", Summary: "One." }] }; }\n```',
    ]);
    const single = { ...rows, examples: '## One file\n\n```json input\n{"files": "a.txt", "summaries": "One."}\n```\n\n```json expect\n{"rows": [{"File": "a.txt"}]}\n```\n' };
    const code: CodeService = { run: async (body) => (body.includes('a.txt') ? { rows: [{ File: 'a.txt', Summary: 'One.' }] } : { rows: [] }) };
    const reply = await generate(single, { ai, code, generationFor, target });
    expect(ai.asked).toHaveLength(2);
    expect(ai.asked[1].prompt).toContain('for the example "One file", output.rows has 0 items; expected 1');
    expect(reply.probe.status).toBe('repaired');
  });

  it('no longer tells every code node about charts -- only a chart downstream says so', async () => {
    const ai = scripted(['```js\nfunction run() { return { rows: [] }; }\n```']);
    await generate(rows, { ai, code: runner(() => ({})), generationFor, target });
    expect(ai.asked[0].prompt).not.toContain('chart');
    expect(registry.widget('plot_window')?.receives({} as never)).toContain('NOT a drawing');
    expect(registry.widget('table')?.receives({} as never)).toContain('column header');
  });

  it('tells a prompt what its model will be sent, laid out as the message says, from the same brief', async () => {
    const ai = scripted(['<system_prompt>Summarize.</system_prompt>']);
    await generate({
      element: 'ai', description: 'Summarize one story in two sentences.',
      inputs: ['story'], outputs: ['output'], input_notes: { story: 'One file per run; arrives as its content' },
      input_sources: { story: '"Folder summaries" (port "Folder")' },
      message_template: 'Story:\n{{story}}',
      output_notes: { output: 'What the model answered' },
      output_format: 'Two sentences, no heading.',
      sample_inputs: { story: 'Once upon a time.' },
    }, { ai, code: runner(() => ({})), generationFor, target });
    const prompt = ai.asked[0].prompt;
    expect(prompt).toContain('## What the model is sent\n- `story`: One file per run; arrives as its content\n  from "Folder summaries" (port "Folder")');
    expect(prompt).toContain('sample, from the last run: "Once upon a time."');
    expect(prompt).toContain('laid out in the message like this');
    expect(prompt).toContain('Story:\n{{story}}');
    expect(prompt).toContain('- `output`: What the model answered');
    expect(prompt).toContain('Format: Two sentences, no heading.');
    expect(prompt).toContain('need not repeat it');
  });
});

describe('a preview', () => {
  it('builds the request exactly as ✨ would, and does not send it', async () => {
    const ai = scripted([]);  // asked anything, it fails the test
    const reply = await generate(
      { element: 'code', description: 'add', inputs: ['a'], outputs: ['out'], preview: true },
      { ai, code: runner(() => { throw new Error('nothing may run'); }), generationFor, target },
    );
    expect(ai.asked).toHaveLength(0);
    expect(reply.preview).toBe(true);
    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0].error).toBeNull();
    expect(reply.calls[0].prompt).toContain('const a = inputs["a"];');
    expect(reply.calls[0].system).toContain('expert software engineer');
  });

  it('is the same request the real call sends', async () => {
    const asked = { element: 'ai', description: 'Be brief.', inputs: ['prompt'] };
    const preview = await generate({ ...asked, preview: true }, { ai: scripted([]), code: runner(() => ({})), generationFor, target });
    const ai = scripted(['<system_prompt>x</system_prompt>']);
    await generate(asked, { ai, code: runner(() => ({})), generationFor, target });
    expect(preview.calls[0].prompt).toBe(ai.asked[0].prompt);
    expect(preview.calls[0].system).toBe(ai.asked[0].system);
  });
});

describe('a node that is handed a file\'s text, not its path', () => {
  const files = (known: Record<string, string>) => ({
    read: async (path: string) => {
      if (!(path in known)) throw new Error(`no such file: ${path}`);
      return known[path];
    },
  }) as never;
  const request = {
    element: 'code', description: 'count rows', inputs: ['csv', 'top'], outputs: ['rows'],
    sample_inputs: { csv: 'data/people.csv', top: '5' },
    input_sources: { csv: '"Page" (port "CSV file")' },
    read_file_ports: ['csv'],
  };

  it('shows the model the text and tries the code on it -- it used to try it on the filename and pass', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { rows: 2 }; }\n```']);
    let received: Record<string, unknown> = {};
    const code: CodeService = { run: async (_body, inputs) => { received = inputs; return { rows: 2 }; } };
    const reply = await generate(request, { ai, code, generationFor, target, files: files({ 'data/people.csv': 'name,age\nAda,36' }) });
    expect(received).toEqual({ csv: 'name,age\nAda,36', top: '5' });
    expect(ai.asked[0].prompt).toContain('sample, from the last run: "name,age\\nAda,36"');
    expect(ai.asked[0].prompt).toContain('from "Page" (port "CSV file"): the text of the file, already read');
    expect(ai.asked[0].prompt).not.toContain('data/people.csv');
    expect(reply.probe.status).toBe('ok');
  });

  it('does not vouch for code when the sample\'s file cannot be read', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { rows: 0 }; }\n```']);
    let probed = false;
    const reply = await generate(request, { ai, code: runner(() => { probed = true; return { rows: 0 }; }), generationFor, target, files: files({}) });
    expect(probed).toBe(false);
    expect(reply.probe.status).toBe('skipped');
  });
});

describe('prose', () => {
  it('takes the text between the tags and the explanation after them', async () => {
    const ai = scripted(['<system_prompt>Be terse.</system_prompt>\nBecause.']);
    const reply = await generate({ element: 'ai', description: 'a terse bot' }, { ai, code: runner(() => ({})), generationFor, target });
    expect(reply).toMatchObject({ result: 'Be terse.', explanation: 'Because.' });
  });

  it('falls back to the whole reply when the model ignored the tags', async () => {
    const ai = scripted(['Just text.']);
    const reply = await generate({ element: 'data', description: 'x' }, { ai, code: runner(() => ({})), generationFor, target });
    expect(reply.result).toBe('Just text.');
  });

  it('answers an output-format request that belongs to no element', async () => {
    const ai = scripted(['<output_format>{ total: number }</output_format>']);
    const reply = await generate({ kind: 'output_format', description: 'x' }, { ai, code: runner(() => ({})), generationFor, target });
    expect(reply.result).toBe('{ total: number }');
  });
});

describe('refusals and failures', () => {
  it('refuses an element that generates nothing, and an unknown kind', async () => {
    const deps = { ai: scripted([]), code: runner(() => ({})), generationFor, target };
    await expect(generate({ element: 'output', description: 'x' }, deps)).rejects.toBeInstanceOf(GenerationRefused);
    await expect(generate({ kind: 'nope', description: 'x' }, deps)).rejects.toBeInstanceOf(GenerationRefused);
  });

  it('hands the transcript back with a failure, since that is when it is worth reading', async () => {
    const ai: AiService = { complete: async () => { throw new Error('no content'); } };
    const failure = await generate({ element: 'code', description: 'x' }, { ai, code: runner(() => ({})), generationFor, target })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GenerationFailed);
    expect((failure as GenerationFailed).calls[0]).toMatchObject({ error: 'no content', reply: null });
  });
});

describe('a sample file in the context', () => {
  it('appends the content and a parsed peek at it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ctx-'));
    const file = join(dir, 'rows.csv');
    await writeFile(file, 'a,b\n1,2\n3,4\n');
    const context = await withContextFile('Given.', file);
    expect(context).toContain('Given.');
    expect(context).toContain('format=csv');
    expect(context).toContain('"a": "1"');
  });

  it('refuses a file it cannot read, by name', async () => {
    await expect(withContextFile('', join(tmpdir(), 'nope.csv'))).rejects.toThrow(/Could not read context file/);
  });

  it('cuts a large sample file to a budget -- the first rows show its shape as well as all of it', async () => {
    const file = join(tmpdir(), `big-${Date.now()}.csv`);
    writeFileSync(file, `a,b\n${'1,2\n'.repeat(20000)}`);
    const context = await withContextFile('', file);
    expect(context.length).toBeLessThan(4000);
    expect(context).toContain('more characters not shown');
  });
});

describe('a whole graph', () => {
  it('parses the fenced document and keeps the explanation', async () => {
    const ai = scripted(['```json\n{"metadata":{"name":"g"},"nodes":[],"edges":[]}\n```\nDone.']);
    const reply = await generateGraph('anything', '', { ai, target });
    expect(reply.graph).toEqual({ metadata: { name: 'g' }, nodes: [], edges: [] });
    expect(reply.explanation).toBe('Done.');
  });

  it('fails, with the transcript, when there is no document to parse', async () => {
    await expect(generateGraph('x', '', { ai: scripted(['no json here']), target })).rejects.toBeInstanceOf(GenerationFailed);
  });
});

describe('a block\'s snippet is looked at before anyone sees it', () => {
  const sample = { value: [{ t: '08:00', temp: 61 }, { t: '08:05', temp: 64 }] };
  const blank = '<svg width="100%" height="100%" viewBox="0 0 400 240"><circle cx="NaN" cy="40" r="3"/></svg>';
  const drawn = '<svg width="100%" height="100%" viewBox="0 0 400 240"><circle cx="60" cy="40" r="3"/></svg>';

  it('runs a chart transform on the sample the block editor sent -- it used to be thrown away', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { value: "GOOD" }; }\n```']);
    const reply = await generate(
      { element: 'plot_window', description: 'a line', sample_inputs: sample },
      { ai, code: runner(() => ({ value: drawn })), generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'ok', attempts: 1 });
  });

  it('hands a drawing full of NaN back with the reason, and keeps the repair', async () => {
    const ai = scripted([
      '```js\nfunction run(i) { return { value: "FIRST" }; }\n```',
      '```js\nfunction run(i) { return { value: "SECOND" }; }\n```',
    ]);
    const reply = await generate(
      { element: 'plot_window', description: 'a line', sample_inputs: sample },
      { ai, code: runner((body) => ({ value: body.includes('SECOND') ? drawn : blank })), generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'repaired', attempts: 2, problems: [] });
    expect(reply.result).toContain('SECOND');
    // The second request carries what was found, in words the model can act on.
    expect(ai.asked[1].prompt).toContain('what is wrong with what it produced');
    expect(ai.asked[1].prompt).toContain('cx="NaN"');
  });

  it('keeps the attempt that got further when the repair is no better, and says what remains', async () => {
    const ai = scripted([
      '```js\nfunction run(i) { return { value: "FIRST" }; }\n```',
      '```js\nfunction run(i) { throw new Error("worse"); }\n```',
    ]);
    const reply = await generate(
      { element: 'plot_window', description: 'a line', sample_inputs: sample },
      { ai, code: runner((body) => { if (body.includes('worse')) throw new Error('worse'); return { value: blank }; }), generationFor, target },
    );
    expect(reply.result).toContain('FIRST');
    expect(reply.probe.status).toBe('failed');
    expect(reply.probe.problems?.[0]).toMatch(/not numbers/);
  });

  it('still ignores a sample keyed by the node\'s ports, which a block\'s snippet does not have', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { value: [] }; }\n```']);
    const reply = await generate(
      { element: 'plot_window', description: 'a line', sample_inputs: { chart_in: [1, 2] } },
      { ai, code: runner(() => { throw new Error('must not run'); }), generationFor, target },
    );
    expect(reply.probe.status).toBe('skipped');
  });
});
