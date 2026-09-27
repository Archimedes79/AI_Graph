import { describe, it, expect } from 'vitest';
import type { AiRequest, AiService, CodeService } from '../../elements/Runtime.ts';
import { registry } from '../../elements/registry.ts';
import { parseWidget } from '../../elements/nodes/gui/GuiNodeRunner.ts';
import { port } from '../../elements/port.ts';
import { executeNode } from '../../execution/executor.ts';
import { inferInterface } from '../../execution/interface.ts';
import { parseGraph } from '../../graph.ts';
import { GenerationFailed, GenerationRefused, generate, generateGraph } from './generate.ts';
import { nodeCode } from '../node.ts';
import type { GenerateRequest } from '../api.ts';

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

  it('leaves the error port to the executor: a body is neither asked for it nor held to it', async () => {
    // A node that catches its failures has an `error` output, which the run
    // fills. Asked for it, a correct body was reported missing a key and
    // "repaired" -- while the brief, filtering it, said something else.
    const ai = scripted(['```js\nfunction run(i) { return { output: 5 }; }\n```']);
    const reply = await generate(
      { element: 'code', description: 'five', inputs: ['input'], outputs: ['output', 'error'], sample_inputs: { input: 1 } },
      { ai, code: runner(() => ({ output: 5 })), generationFor, target },
    );
    expect(ai.asked[0].prompt).toContain('The returned object\'s keys must be exactly: ["output"]');
    expect(ai.asked[0].prompt).not.toMatch(/"error"/);
    expect(reply.probe).toMatchObject({ status: 'ok', attempts: 1, missing_outputs: [] });
  });

  it('verifies against the sample and reports what the code returned, whole', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { out: i.a * 2 }; }\n```']);
    const reply = await generate(
      { element: 'code', description: 'double', inputs: ['a'], outputs: ['out'], sample_inputs: { a: 21 } },
      { ai, code: runner(() => ({ out: 42 })), generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'ok', attempts: 1, outputs: { out: 42 } });
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
    expect(ai.asked[0].prompt).toContain('- `value`');
    expect(ai.asked[0].prompt).toContain('Must expose draw(data, window)');    // the block's own contract
  });

  it('asks for a chart\'s draw(data, window) in the page\'s worker, and nothing a graph\'s node is told', async () => {
    // It was told draw(data, window), then "complete function run(inputs), keep
    // its name", then Node's standard library -- and followed the skeleton.
    const ai = scripted(['```js\nfunction draw(data, window) { return []; }\n```']);
    await generate({ element: 'plot_window', description: 'a line of the temperatures' }, { ai, code: runner(() => ({})), generationFor, target });
    const { prompt, system } = ai.asked[0];
    expect(prompt).toContain('## The function\nComplete this function. Keep its name and its two parameters');
    expect(prompt).toContain('function draw(data, window) {');
    expect(prompt).toContain('runs in a worker');
    expect(prompt).not.toContain('function run(inputs)');
    expect(prompt).not.toContain('one node of a graph');
    expect(prompt).not.toContain('Node has built in');
    expect(prompt).not.toContain('Downstream nodes');
    expect(prompt).not.toContain('## Also');                                   // the contract is the frame, said once
    expect(system).not.toContain('node.llm');
    expect(system).not.toContain('downstream nodes');
  });

  it('still asks a table\'s transform for run(inputs) in the sandbox, which is where it runs', async () => {
    const ai = scripted(['```js\nfunction run(inputs) { return { value: [] }; }\n```']);
    await generate({ element: 'table', description: 'one row per file' }, { ai, code: runner(() => ({})), generationFor, target });
    expect(ai.asked[0].prompt).toContain('function run(inputs) {');
    expect(ai.asked[0].prompt).toContain('Node has built in');
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

  it('tells the node upstream to pre-shape nothing when the block reshapes what arrives itself', () => {
    // A chart whose draw() reads rows was still said to want points, so the
    // node feeding it was written to hand it points, which its draw() read as rows.
    for (const kind of ['plot_window', 'table', 'image_view'] as const) {
      const element = registry.widget(kind)!;
      expect(element.receives(parseWidget({ id: 'b', kind, code: '' }))).toBeTruthy();
      expect(element.receives(parseWidget({ id: 'b', kind, code: 'function draw(rows) { return rows.map((r) => r.temp); }' }))).toBeUndefined();
    }
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

describe('a node run once per item', () => {
  /** A body run in this process: the probe and a run both reach it through `CodeService`, so they can be compared. */
  const inProcess: CodeService = {
    run: async (body, inputs) => new Function('inputs', `${body}\nreturn run(inputs);`)(inputs) as Record<string, unknown>,
  };
  const request = {
    element: 'code', description: 'Shout each word.', inputs: ['text'], outputs: ['out'],
    input_types: { text: 'text' }, batch_mode: 'per_item' as const,
    sample_inputs: { text: ['alpha', 'beta'] },
  };
  const shout = '```js\nfunction run(inputs) { return { out: inputs.text.toUpperCase() }; }\n```';

  it('is shown and tried on one item, as `run` is called -- a correct body used to fail on the whole list', async () => {
    const ai = scripted([shout]);
    const tried: unknown[] = [];
    const code: CodeService = { run: async (body, inputs) => { tried.push(inputs.text); return inProcess.run(body, inputs); } };
    const reply = await generate(request, { ai, code, generationFor, target });
    const prompt = ai.asked[0].prompt;
    expect(prompt).toContain('sample, from the last run, the first of its 2 items: "alpha"');
    expect(prompt).toContain('@property {string} text\n');
    // What goes out is said as the list a run collects, so an example's list
    // of two is not read as what one call must return.
    expect(prompt).toContain('What the calls return is collected into one list per output');
    expect(tried).toEqual(['alpha']);
    expect(reply.probe).toMatchObject({ status: 'ok', attempts: 1 });
  });

  it('turns away a body written for the list, which the probe used to pass and every item of a run failed', async () => {
    const ai = scripted([
      '```js\nfunction run(inputs) { return { out: inputs.text.map((word) => word.toUpperCase()) }; }\n```',
      shout,
    ]);
    const reply = await generate(request, { ai, code: inProcess, generationFor, target });
    expect(ai.asked[1].prompt).toContain('inputs["text"]: string = "alpha"');
    expect(reply.probe.status).toBe('repaired');
    expect(reply.result).not.toContain('.map(');
  });

  it('keeps the shape a run of the node hands on, not the shape of one call', async () => {
    const ai = scripted([shout]);
    const reply = await generate(request, { ai, code: inProcess, generationFor, target });
    const graph = parseGraph({
      nodes: [{
        id: 'shout', node_type: 'code', config: { code: reply.result, batch_mode: 'per_item' },
        inputs: [port('text', 'Text', 'input', 'any', true)], outputs: [port('out', 'Out', 'output', 'any', true)],
      }],
    });
    const runtime = { code: inProcess, ai, files: {} as never };
    const ran = await executeNode(graph, 'shout', { text: ['alpha', 'beta'] }, { runtime, registry });
    expect(ran.outputs).toEqual({ out: ['ALPHA', 'BETA'] });
    // One item was tried; what it hands on is a list, as the run's is.
    expect(reply.probe.outputs).toEqual({ out: ['ALPHA'] });
    expect(inferInterface(reply.probe.outputs!)).toEqual(inferInterface(ran.outputs));
  });

  it('does not cut a list the body is handed whole, and a list of one is its one item', async () => {
    const ai = scripted([shout]);
    let tried: Record<string, unknown> = {};
    const code: CodeService = { run: async (body, inputs) => { tried = inputs; return inProcess.run(body, inputs); } };
    const reply = await generate({
      ...request, inputs: ['text', 'stop'], input_types: { text: 'text', stop: 'list of text' },
      sample_inputs: { text: ['alpha'], stop: ['a', 'the'] },
    }, { ai, code, generationFor, target });
    expect(tried).toEqual({ text: 'alpha', stop: ['a', 'the'] });
    expect(ai.asked[0].prompt).toContain('sample, from the last run, its one item: "alpha"');
    expect(reply.probe).toMatchObject({ status: 'ok', outputs: { out: ['ALPHA'] } });
  });

  it('hands on a list even for one item, as a run of the node\'s list output does -- it kept the bare answer', async () => {
    // What a run of the node as it is created hands on: a multi output
    // collects its answers whatever their number, so a run of one item hands
    // on a list of one, and a single value arriving is a run of one item.
    const graph = parseGraph({
      nodes: [{
        id: 'shout', node_type: 'code', config: { code: shout.split('\n')[1], batch_mode: 'per_item' },
        inputs: [port('text', 'Text', 'input', 'any', true)], outputs: [port('out', 'Out', 'output', 'any', true)],
      }],
    });
    for (const text of [['alpha'], 'alpha']) {
      const reply = await generate({ ...request, sample_inputs: { text } }, { ai: scripted([shout]), code: inProcess, generationFor, target });
      const ran = await executeNode(graph, 'shout', { text }, { runtime: { code: inProcess, ai: scripted([]), files: {} as never }, registry });
      expect(ran.outputs).toEqual({ out: ['ALPHA'] });
      expect(reply.probe.outputs).toEqual(ran.outputs);
    }
  });

  it('holds a correct body to an example kept from a run of one item, list and all', async () => {
    // `test` holds the example to what the node hands on, a list of one; held
    // to the bare answer, the probe failed a correct body and asked for a repair.
    const kept = '## One word\n\n```json input\n{"text": ["alpha"]}\n```\n\n```json expect\n{"out": ["ALPHA"]}\n```\n';
    const reply = await generate({ ...request, sample_inputs: undefined, examples: kept }, { ai: scripted([shout]), code: inProcess, generationFor, target });
    expect(reply.probe).toMatchObject({ status: 'ok', attempts: 1, problems: [] });
    // A port declared single hands on the bare answer, and the request cannot say which ports are: that meets it too.
    const typed = '## One word\n\n```json input\n{"text": "alpha"}\n```\n\n```json expect\n{"out": "ALPHA"}\n```\n';
    const single = await generate({ ...request, sample_inputs: undefined, examples: typed }, { ai: scripted([shout]), code: inProcess, generationFor, target });
    expect(single.probe).toMatchObject({ status: 'ok', attempts: 1 });
    // And a wrong answer meets neither.
    const lower = '```js\nfunction run(inputs) { return { out: inputs.text }; }\n```';
    const wrong = await generate({ ...request, sample_inputs: undefined, examples: kept }, { ai: scripted([lower, lower]), code: inProcess, generationFor, target });
    expect(wrong.probe.status).toBe('failed');
    expect(wrong.probe.problems?.[0]).toContain('for the example "One word", output.out[0] is "alpha"; expected "ALPHA"');
  });

  it('tries nothing on an empty list, which a run never calls the body for', async () => {
    const ai = scripted([shout]);
    const reply = await generate({ ...request, sample_inputs: { text: [] } },
      { ai, code: runner(() => { throw new Error('must not run'); }), generationFor, target });
    expect(reply.probe.status).toBe('skipped');
    expect(ai.asked[0].prompt).not.toContain('sample, from');
  });

  it('holds one item to no example of the whole node, and a body taking the list whole to its example', async () => {
    const examples = '## Two words\n\n```json input\n{"text": ["alpha", "beta"]}\n```\n\n```json expect\n{"out": ["ALPHA", "BETA"]}\n```\n';
    const perItem = await generate({ ...request, sample_inputs: undefined, examples }, { ai: scripted([shout]), code: inProcess, generationFor, target });
    expect(perItem.probe.status).toBe('ok');

    const ai = scripted([
      '```js\nfunction run(inputs) { return { out: [] }; }\n```',
      '```js\nfunction run(inputs) { return { out: inputs.text.map((word) => word.toUpperCase()) }; }\n```',
    ]);
    const whole = await generate({
      ...request, batch_mode: 'whole_list', input_types: { text: 'list of text' }, sample_inputs: undefined, examples,
    }, { ai, code: inProcess, generationFor, target });
    expect(ai.asked[1].prompt).toContain('for the example "Two words", output.out has 0 items; expected 2');
    expect(whole.probe.status).toBe('repaired');
  });

  it('cuts only the inputs the node declares lists, when the request says which', async () => {
    // Guessed from the types, a list arriving on a port that is not typed
    // "list of" was cut as if it fanned out; a run hands it on whole.
    let tried: Record<string, unknown> = {};
    const code: CodeService = { run: async (body, inputs) => { tried = inputs; return inProcess.run(body, inputs); } };
    await generate({
      ...request, inputs: ['text', 'stop'], input_types: { text: 'text', stop: 'any' }, multi_inputs: ['text'],
      sample_inputs: { text: ['alpha', 'beta'], stop: ['a', 'the'] },
    }, { ai: scripted([shout]), code, generationFor, target });
    expect(tried).toEqual({ text: 'alpha', stop: ['a', 'the'] });
  });

  it('hands a lone answer on as it came from an output declared single, as a run of one item does', async () => {
    const graph = parseGraph({
      nodes: [{
        id: 'shout', node_type: 'code', config: { code: shout.split('\n')[1], batch_mode: 'per_item' },
        inputs: [port('text', 'Text', 'input', 'any', true)], outputs: [port('out', 'Out', 'output', 'any', false)],
      }],
    });
    const ran = await executeNode(graph, 'shout', { text: ['alpha'] }, { runtime: { code: inProcess, ai: scripted([]), files: {} as never }, registry });
    const reply = await generate({ ...request, sample_inputs: { text: ['alpha'] }, multi_inputs: ['text'], multi_outputs: [] },
      { ai: scripted([shout]), code: inProcess, generationFor, target });
    expect(ran.outputs).toEqual({ out: 'ALPHA' });
    expect(reply.probe.outputs).toEqual(ran.outputs);
  });

  it('tells a prompt that the model is sent one item, and shows it that item', async () => {
    const ai = scripted(['<system_prompt>Summarise the story.</system_prompt>']);
    await generate({
      element: 'ai', description: 'Summarise each story.', inputs: ['story'], outputs: ['output'],
      input_types: { story: 'text' }, batch_mode: 'per_item', sample_inputs: { story: ['Once.', 'Twice.', 'Thrice.'] },
    }, { ai, code: runner(() => ({})), generationFor, target });
    const prompt = ai.asked[0].prompt;
    expect(prompt).toContain('sample, from the last run, the first of its 3 items: "Once."');
    expect(prompt).toContain('the model is called once per item and is sent that one item');
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
});

describe('refusals and failures', () => {
  it('refuses an element that generates nothing, and a request that names no element', async () => {
    const deps = { ai: scripted([]), code: runner(() => ({})), generationFor, target };
    await expect(generate({ element: 'output', description: 'x' }, deps)).rejects.toBeInstanceOf(GenerationRefused);
    // What arrives over the wire is not held to the type: a body without one.
    await expect(generate({ description: 'x' } as GenerateRequest, deps)).rejects.toBeInstanceOf(GenerationRefused);
  });

  it('hands the transcript back with a failure, since that is when it is worth reading', async () => {
    const ai: AiService = { complete: async () => { throw new Error('no content'); } };
    const failure = await generate({ element: 'code', description: 'x' }, { ai, code: runner(() => ({})), generationFor, target })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GenerationFailed);
    expect((failure as GenerationFailed).calls[0]).toMatchObject({ error: 'no content', reply: null });
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

  it('tries a chart the way its page draws it: a body asking node.llm fails here, and a figure passes', async () => {
    // The page's worker hands run() a window, not a node. With a node here, the
    // question was answered, the probe and `check` said ✓, and the page failed.
    const ai = scripted([
      '```js\nasync function run(inputs, node) { return { value: await node.llm({ prompt: "chart it" }) }; }\n```',
      '```js\nfunction draw(data, window) { return { kind: "line", title: "Temperature", points: data.map((row) => ({ label: row.t, value: row.temp })) }; }\n```',
    ]);
    const reply = await generate({ element: 'plot_window', description: 'a line', sample_inputs: sample }, { ai, code: nodeCode, generationFor, target });
    expect(ai.asked).toHaveLength(2);                                  // nobody answered the chart's question
    expect(ai.asked[1].prompt).toContain('node.llm is not a function');
    expect(reply.probe).toMatchObject({ status: 'repaired', problems: [] });
    expect(reply.probe.outputs).toEqual({ value: { kind: 'line', title: 'Temperature', points: [{ label: '08:00', value: 61 }, { label: '08:05', value: 64 }] } });
  }, 30_000);

  it('tells the repair the line of the chart\'s body an error is on, as the body is shown to it', async () => {
    // The wrapper that calls it as the page does stood two lines above it, and
    // the repair was told of a line 5 in a body of four.
    const ai = scripted([
      '```js\nfunction draw(data, window) {\n  const rows = data;\n  return rows.nope.map((row) => row.temp);\n}\n```',
      '```js\nfunction draw(data) { return data.map((row) => row.temp); }\n```',
    ]);
    const reply = await generate({ element: 'plot_window', description: 'a line', sample_inputs: sample }, { ai, code: nodeCode, generationFor, target });
    expect(ai.asked[1].prompt).toMatch(/reading 'map'\)[\s\S]*\bline 3, column \d+/);
    expect(reply.probe.status).toBe('repaired');
  }, 30_000);

  it('still ignores a sample keyed by the node\'s ports, which a block\'s snippet does not have', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { value: [] }; }\n```']);
    const reply = await generate(
      { element: 'plot_window', description: 'a line', sample_inputs: { chart_in: [1, 2] } },
      { ai, code: runner(() => { throw new Error('must not run'); }), generationFor, target },
    );
    expect(reply.probe.status).toBe('skipped');
  });
});
