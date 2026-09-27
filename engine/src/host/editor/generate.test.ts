import { describe, it, expect } from 'vitest';
import type { AiRequest, AiService, CodeService } from '../../elements/Runtime.ts';
import { registry } from '../../elements/registry.ts';
import { parseWidget } from '../../elements/nodes/gui/GuiNodeRunner.ts';
import { port } from '../../elements/port.ts';
import { executeNode } from '../../execution/executor.ts';
import { inferInterface } from '../../execution/interface.ts';
import { parseGraph } from '../../graph.ts';
import { GenerationFailed, GenerationRefused, firstCodeBlock, generate, generateGraph } from './generate.ts';
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

const generationFor = (name: string) => registry.generation(name);
const target = { provider: 'test', model: 'm' };

describe('code', () => {
  it('asks for a function against the skeleton, and keeps what came back in the fence', async () => {
    const ai = scripted(['```javascript\nfunction run(inputs) { return { out: 1 }; }\n```\nIt adds.']);
    const reply = await generate(
      { element: 'code', prompt: 'add', inputs: ['a'], outputs: ['out'] },
      { ai, code: runner(() => ({})), generationFor, target },
    );
    expect(reply.result).toBe('function run(inputs) { return { out: 1 }; }');
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
      { element: 'code', prompt: 'five', inputs: ['input'], outputs: ['output', 'error'], sample_inputs: { input: 1 } },
      { ai, code: runner(() => ({ output: 5 })), generationFor, target },
    );
    expect(ai.asked[0].prompt).toContain('The returned object\'s keys must be exactly: ["output"]');
    expect(ai.asked[0].prompt).not.toMatch(/"error"/);
    expect(reply.probe).toMatchObject({ status: 'ok', missing_outputs: [] });
  });

  it('verifies against the sample and reports what the code returned, whole', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { out: i.a * 2 }; }\n```']);
    const reply = await generate(
      { element: 'code', prompt: 'double', inputs: ['a'], outputs: ['out'], sample_inputs: { a: 21 } },
      { ai, code: runner(() => ({ out: 42 })), generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'ok', outputs: { out: 42 } });
  });

  it('repairs once with the evidence when the first attempt misses a key', async () => {
    const ai = scripted([
      '```js\nfunction run(i) { return { wrong: 1 }; }\n```',
      '```js\nfunction run(i) { return { out: 1 }; }\n```',
    ]);
    const reply = await generate(
      { element: 'code', prompt: 'x', outputs: ['out'], sample_inputs: { a: 1 } },
      { ai, code: runner((body) => (body.includes('wrong') ? { wrong: 1 } : { out: 1 })), generationFor, target },
    );
    expect(reply.probe.status).toBe('repaired');
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
      { element: 'code', prompt: 'x', outputs: ['out'], sample_inputs: { a: 1 } },
      { ai, code: runner((body) => { if (body.includes('boom')) throw new Error('boom'); return { wrong: 1 }; }), generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'failed', missing_outputs: ['out'] });
    expect(reply.result).toContain('wrong: 1');
  });

  it('is not offered for a block, nor for a folder listing: neither has code to write', async () => {
    for (const kind of ['plot_window', 'table', 'image_view', 'input_picker', 'input']) {
      await expect(generate({ element: kind, prompt: 'x' }, { ai: scripted([]), code: runner(() => ({})), generationFor, target }))
        .rejects.toThrow(GenerationRefused);
    }
  });
});

describe('changing a body there is (refine)', () => {
  it('writes code from the function as it is, what it returned and what to change -- and restates the request with it', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { out: i.a * 3 }; }\n```\nNow triples.\n<request>Triple the number.</request>']);
    const reply = await generate(
      {
        element: 'code', prompt: 'Double the number.', inputs: ['a'], outputs: ['out'], sample_inputs: { a: 2 },
        refine: { body: 'function run(i) { return { out: i.a * 2 }; }', outcome: '{"out": 4}', change: 'Triple it instead.' },
      },
      { ai, code: runner(() => ({ out: 6 })), generationFor, target },
    );
    const asked = ai.asked[0].prompt;
    expect(asked).toContain('--- the function as it is now ---\nfunction run(i) { return { out: i.a * 2 }; }');
    expect(asked).toContain('--- what it returned on the last run ---\n{"out": 4}');
    expect(asked).toContain('--- what to change ---\nTriple it instead.');
    expect(asked).toContain('<request></request>');
    expect(reply).toMatchObject({ result: 'function run(i) { return { out: i.a * 3 }; }', request: 'Triple the number.' });
    // Tried on the sample like any body written, with the one repair behind it.
    expect(reply.probe).toMatchObject({ status: 'ok', outputs: { out: 6 } });
  });

  it('brings no task back where no change was asked, whatever the model offered: the person\'s task is not written over', async () => {
    const ai = scripted(['<system_prompt>You name capitals.</system_prompt>\n<request>Something else entirely.</request>']);
    const reply = await generate(
      { element: 'ai', prompt: 'Name the capital.', inputs: ['prompt'], outputs: ['output'] },
      { ai, code: runner(() => ({})), generationFor, target },
    );
    expect(reply.result).toBe('You name capitals.');
    expect(reply.request).toBeUndefined();
  });

  it('fixes code from how it failed, the inputs it failed on and the body: the repair step, and the request stays', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { out: String(i.a).length }; }\n```']);
    const reply = await generate(
      {
        element: 'code', prompt: 'Count the characters.', inputs: ['a'], outputs: ['out'], sample_inputs: { a: 12345 },
        refine: { body: 'function run(i) { return { out: i.a.length }; }', error: 'Cannot read properties of undefined' },
      },
      { ai, code: runner(() => ({ out: 5 })), generationFor, target },
    );
    const asked = ai.asked[0].prompt;
    expect(asked).toContain('--- your previous attempt ---\nfunction run(i) { return { out: i.a.length }; }');
    expect(asked).toContain('inputs["a"]: number = 12345');
    expect(asked).toContain('--- the error it raised ---\nCannot read properties of undefined');
    expect(asked).not.toContain('<request>');
    expect(reply.request).toBeUndefined();
    expect(reply.probe.status).toBe('ok');
  });

  describe('held to an example written before it', () => {
    /** A body run in this process, as the sandbox would run it. */
    const evaluated: CodeService = {
      run: async (body, inputs) => new Function('inputs', `${body}\nreturn run(inputs);`)(inputs) as Record<string, unknown>,
    };
    // The example as the dialog writes it when a result was kept: an input, and what must come out.
    const examples = '## The example\n\n```json input\n{"name": "anna"}\n```\n\n```json expect\n{"out": "anna"}\n```\n';
    const asked = {
      element: 'code', prompt: 'Return the name.', inputs: ['name'], outputs: ['out'], examples,
      refine: { body: 'function run(i) { return { out: i.name }; }', outcome: 'anna', change: 'Return it in upper case.' },
    };

    it('is not: the repair turned the change back to the example, and the request said it was made', async () => {
      const ai = scripted([
        '```js\nfunction run(i) { return { out: String(i.name).toUpperCase() }; }\n```\n<request>Return the name in upper case.</request>',
        // What a repair held to the old example writes: the body from before the change.
        '```js\nfunction run(i) { return { out: i.name }; }\n```',
      ]);
      const reply = await generate(asked, { ai, code: evaluated, generationFor, target });
      expect(ai.asked).toHaveLength(1);
      expect(reply).toMatchObject({ result: 'function run(i) { return { out: String(i.name).toUpperCase() }; }', request: 'Return the name in upper case.' });
      expect(reply.probe).toMatchObject({ status: 'ok', outputs: { out: 'ANNA' }, problems: [] });
      // Told what the examples are: written before the change, which wins.
      expect(ai.asked[0].prompt).toContain('Examples -- written before this change: where one disagrees with the change, the change wins:');
    });

    it('and a change that does not run is repaired as the change, from the request it restated', async () => {
      const ai = scripted([
        '```js\nfunction run(i) { return { out: i.name.toUpperCase() }; }\n```\n<request>Return the name in upper case.</request>',
        '```js\nfunction run(i) { return { out: String(i.name).toUpperCase() }; }\n```',
      ]);
      const reply = await generate({ ...asked, examples: examples.replace('"anna"}', '5}') }, { ai, code: evaluated, generationFor, target });
      const repair = ai.asked[1].prompt;
      // The bare request, restated -- and sent in the standard template, after Prompt:.
      expect(repair).toContain('Prompt:\nReturn the name in upper case.');
      expect(repair).not.toContain('Prompt:\nReturn the name.');
      expect(repair).toContain('--- the change it was written to make, which the fix keeps ---\nReturn it in upper case.');
      expect(repair).toContain('i.name.toUpperCase is not a function');
      expect(reply).toMatchObject({ result: 'function run(i) { return { out: String(i.name).toUpperCase() }; }', request: 'Return the name in upper case.' });
      expect(reply.probe.status).toBe('repaired');
    });
  });

  it('writes a system prompt from the one there is, what the model answered and what to change, with the request restated', async () => {
    const ai = scripted(['<system_prompt>Answer in one word.</system_prompt>\nShorter now.\n<request>Name the capital, in one word.</request>']);
    const reply = await generate(
      {
        element: 'ai', prompt: 'Name the capital.', inputs: ['prompt'], outputs: ['output'],
        refine: { body: 'Name the capital of the country.', outcome: 'The capital of France is Paris.', change: 'One word only.' },
      },
      { ai, code: runner(() => ({})), generationFor, target },
    );
    expect(ai.asked[0].prompt).toContain('## The system prompt as it is now\n\nName the capital of the country.');
    expect(ai.asked[0].prompt).toContain('## What to change\n\nOne word only.');
    expect(reply).toMatchObject({ result: 'Answer in one word.', request: 'Name the capital, in one word.' });
  });
});

describe('the code in a model\'s answer', () => {
  const fence = '```';
  it('is found behind any info string, with Windows line ends too', () => {
    expect(firstCodeBlock(`Here:\n${fence}javascript \nfunction run() {}\n${fence}\nDone.`)).toBe('function run() {}');
    expect(firstCodeBlock(`${fence}js title="run.js"\r\nfunction run() {}\r\n${fence}`)).toBe('function run() {}');
  });

  it('does not end at a fence the code writes into a string', () => {
    const code = 'function run() {\n  return { md: "' + fence + 'json\\n{}\\n' + fence + '" };\n}';
    expect(firstCodeBlock(`${fence}js\n${code}\n${fence}`)).toBe(code);
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
      { element: 'code', prompt: 'classify the row with the model', inputs: ['row'], outputs: ['label'], sample_inputs: { row: 'apple' } },
      { ai, code: nodeCode, generationFor, target },
    );
    expect(reply.probe).toMatchObject({ status: 'ok', outputs: { label: 'fruit' } });
    expect(ai.asked[1].prompt).toContain('Classify: apple');
  }, 30_000);
});

describe('what the node says about itself reaches the model', () => {
  // The port descriptions, the kept output shape and the examples were used to
  // check a body and never to write one; pressing ✨ again could rename a
  // table's columns with every check still passing.
  const rows = {
    element: 'code', prompt: 'One table row per file.',
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
    // In the standard template, the request last: a bare request is sent in it.
    expect(prompt).toContain('Input:\n- `files`: Every path in the folder');
    // No run yet: the example's inputs are the sample, and say so.
    expect(prompt).toContain('sample, from the example "Two files": a list of 1: ["a.txt"]');
    expect(prompt).toContain('Output Example:\n- `rows`: A list of {File, Summary}');
    expect(prompt).toContain('Graph Context:\nNot given.\n\nPrompt:\nOne table row per file.\n');
    expect(prompt).toContain('keep it: { rows: list of anything }');
    expect(prompt).toContain('must return, at least: {"rows":[{"File":"a.txt","Summary":"One."}]}');
    // Said once: the skeleton is the signature, typed from the sample, with no second copy of the notes.
    expect(prompt).toContain('@property {string[]} files\n');
    expect(prompt.split('Every path in the folder')).toHaveLength(2);
  });

  it('sends the output format whatever else is set, cut to a budget', async () => {
    const ai = scripted(['```js\nfunction run() { return { rows: [] }; }\n```']);
    await generate({
      ...rows, examples: undefined, output_format: 'A list of {File, Summary}, largest first.',
      sample_inputs: { files: ['x'.repeat(5000)], summaries: ['y'] },
    }, { ai, code: runner(() => ({ rows: [] })), generationFor, target });
    const prompt = ai.asked[0].prompt;
    expect(prompt).toContain('Its output definition (output.md):\nA list of {File, Summary}, largest first.');
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
    expect(registry.widget('plot_window')?.receives(parseWidget({ id: 'b', kind: 'plot_window' }))).toContain('draws at the block\'s real size');
    expect(registry.widget('table')?.receives(parseWidget({ id: 'b', kind: 'table' }))).toContain('column header');
  });

  it('tells the node upstream what a drawing block takes', () => {
    // A block reshapes nothing itself: the node wired into it hands it what it draws.
    for (const kind of ['plot_window', 'table', 'image_view'] as const) {
      expect(registry.widget(kind)!.receives(parseWidget({ id: 'b', kind })), kind).toBeTruthy();
    }
  });

  it('tells a prompt what its model will be sent, laid out as the message says, from the same brief', async () => {
    const ai = scripted(['<system_prompt>Summarize.</system_prompt>']);
    await generate({
      element: 'ai', prompt: 'Summarize one story in two sentences.',
      inputs: ['story'], outputs: ['output'], input_notes: { story: 'One file per run; arrives as its content' },
      input_sources: { story: '"Folder summaries" (port "Folder")' },
      message_template: 'Story:\n{{story}}',
      output_notes: { output: 'What the model answered' },
      output_format: 'Two sentences, no heading.',
      sample_inputs: { story: 'Once upon a time.' },
    }, { ai, code: runner(() => ({})), generationFor, target });
    const prompt = ai.asked[0].prompt;
    expect(prompt).toContain('Input:\n- `story`: One file per run; arrives as its content\n  from "Folder summaries" (port "Folder")');
    expect(prompt).toContain('sample, from the last run: "Once upon a time."');
    expect(prompt).toContain('laid out in the message like this');
    expect(prompt).toContain('Story:\n{{story}}');
    expect(prompt).toContain('- `output`: What the model answered');
    expect(prompt).toContain('Its output definition (output.md):\nTwo sentences, no heading.');
    // The frame: what to write, in which tags, and what is added to it at run time.
    expect(prompt).toContain('inside <message_template></message_template> tags, with {{story}} standing for each input\'s value');
    expect(prompt).toContain('need not repeat it');
  });
});

describe('the node\'s prompt.md', () => {
  it('is sent as the person laid it out: the variables filled, any other brace as written, and the frame after it', async () => {
    const ai = scripted(['```js\nfunction run() { return { out: 1 }; }\n```']);
    const prompt = 'Data:\n{Input Needs}\n\nAnswer like {"out": 1}.\n\nPrompt:\nCount the rows.';
    await generate({ element: 'code', prompt, inputs: ['csv'], outputs: ['out'] }, { ai, code: runner(() => ({})), generationFor, target });
    const sent = ai.asked[0].prompt;
    expect(sent.startsWith('Data:\n- `csv`\n\nAnswer like {"out": 1}.\n\nPrompt:\nCount the rows.\n')).toBe(true);
    expect(sent).not.toContain('Output Example:');
    expect(sent).toContain('## The function\nWrite the JavaScript function this node runs');
  });

  it('says a request nobody wrote is not said yet, rather than sending nothing after Prompt:', async () => {
    const ai = scripted(['```js\nfunction run() { return {}; }\n```']);
    await generate({ element: 'code', prompt: '' }, { ai, code: runner(() => ({})), generationFor, target });
    expect(ai.asked[0].prompt).toContain('Prompt:\n(not said yet)');
  });

  it('fills {Graph} with the graph around the node', async () => {
    const ai = scripted(['<system_prompt>x</system_prompt>']);
    await generate({ element: 'ai', prompt: 'Be brief.', graph_context: 'A page with a chart, 1106 x 616 px.' },
      { ai, code: runner(() => ({})), generationFor, target });
    expect(ai.asked[0].prompt).toContain('Graph Context:\nA page with a chart, 1106 x 616 px.\n\nPrompt:\nBe brief.');
  });
});

describe('an ai node\'s instructions', () => {
  it('come with the message they are sent with, each in its tags', async () => {
    const ai = scripted(['<system_prompt>Summarise the story.</system_prompt>\n<message_template>Length: {{length}}\n\n{{story}}</message_template>\nDone.']);
    const reply = await generate({ element: 'ai', prompt: 'Summarise it.', inputs: ['story', 'length'], outputs: ['output'] },
      { ai, code: runner(() => ({})), generationFor, target });
    expect(reply).toMatchObject({ result: 'Summarise the story.', message_template: 'Length: {{length}}\n\n{{story}}' });
    expect(ai.asked[0].prompt).toContain('with {{story}}, {{length}} standing for each input\'s value');
  });

  it('leave the message as it is where the model wrote none, and where a change was asked', async () => {
    const none = await generate({ element: 'ai', prompt: 'x', inputs: ['story'] },
      { ai: scripted(['<system_prompt>Be terse.</system_prompt>']), code: runner(() => ({})), generationFor, target });
    expect(none).not.toHaveProperty('message_template');
    const changed = await generate({
      element: 'ai', prompt: 'x', inputs: ['story'], refine: { body: 'Be terse.', change: 'Terser.' },
    }, { ai: scripted(['<system_prompt>Be terser.</system_prompt><message_template>{{story}}!</message_template>']), code: runner(() => ({})), generationFor, target });
    expect(changed).not.toHaveProperty('message_template');
  });
});

describe('an example, written for the node', () => {
  const asked: GenerateRequest = {
    element: 'code', prompt: 'Plot the rows.', write: 'example', inputs: ['csv', 'top'], outputs: ['figure'],
    read_file_ports: ['csv'], sample_inputs: { csv: 'D:/data/real.csv', top: 3 },
  };

  it('is one input object -- a file-reading input naming the example file it wrote -- and is not run', async () => {
    const ai = scripted(['```json\n{"csv": {"file": "../../countries list.csv", "content": "name,value\\nIndia,1450"}, "top": 2, "other": 1}\n```']);
    const reply = await generate(asked, { ai, code: runner(() => { throw new Error('nothing runs'); }), generationFor, target });
    expect(reply.example).toEqual({
      inputs: { csv: 'example/countries_list.csv', top: 2 },
      files: { 'example/countries_list.csv': 'name,value\nIndia,1450' },
    });
    expect(reply.result).toBe('');
    expect(reply.probe.status).toBe('skipped');
    // Written from what the node knows, without a sample to copy.
    const sent = ai.asked[0].prompt;
    expect(sent).toContain('Prompt:\nPlot the rows.');
    expect(sent).not.toContain('real.csv');
    expect(sent).toContain('For an input that reads a file ("csv"), give the file itself');
    expect(ai.asked[0].system).toContain('example data');
  });

  it('gives a list of files a name each, and a file without a name one of its input\'s', async () => {
    const ai = scripted(['{"csv": [{"file": "a.csv", "content": "1"}, {"file": "a.csv", "content": "2"}, "3"], "top": 1}']);
    const reply = await generate(asked, { ai, code: runner(() => ({})), generationFor, target });
    expect(reply.example?.inputs.csv).toEqual(['example/a.csv', 'example/a_2.csv', 'example/csv_3.txt']);
    expect(reply.example?.files).toEqual({ 'example/a.csv': '1', 'example/a_2.csv': '2', 'example/csv_3.txt': '3' });
  });

  it('refuses a file larger than an example holds, and an answer that is not an object', async () => {
    const big = JSON.stringify({ csv: { file: 'big.csv', content: 'x'.repeat(210 * 1024) } });
    await expect(generate(asked, { ai: scripted([big]), code: runner(() => ({})), generationFor, target }))
      .rejects.toThrow(/"csv" is 210 KB, and an example file holds at most 200 KB/);
    await expect(generate(asked, { ai: scripted(['Here is one: csv=1']), code: runner(() => ({})), generationFor, target }))
      .rejects.toThrow(/is not JSON\. It began: "Here is one/);
  });
});

describe('an output definition, written for the node', () => {
  const asked: GenerateRequest = {
    element: 'ai', prompt: 'Map the file onto rows.', write: 'output', inputs: ['file'], outputs: ['output'],
    output_format: 'One row per line, as JSON.', output_targets: { output: '"Rows" table on the page -- wants: a list of objects' },
    sample_inputs: { file: 'a;b' },
  };

  it('is Markdown, written from where the outputs go, what it says now and the sample -- and is not run', async () => {
    const ai = scripted(['`output`: a list of rows.\n\n```json\n{"output": [{"a": "b"}]}\n```']);
    const reply = await generate(asked, { ai, code: runner(() => { throw new Error('nothing runs'); }), generationFor, target });
    expect(reply.result).toBe('`output`: a list of rows.\n\n```json\n{"output": [{"a": "b"}]}\n```');
    const sent = ai.asked[0].prompt;
    expect(sent).toContain('to "Rows" table on the page -- wants: a list of objects');
    expect(sent).toContain('Its output definition (output.md):\nOne row per line, as JSON.');
    expect(sent).toContain('sample, from the last run: "a;b"');
    expect(sent).toContain('is the person\'s own brief: keep what it says, in substance');
  });

  it('is taken out of a fence around the whole of it, and only then', async () => {
    const wrapped = '```markdown\n`output`: rows.\n\n```json\n{"output": []}\n```\n```';
    expect((await generate(asked, { ai: scripted([wrapped]), code: runner(() => ({})), generationFor, target })).result)
      .toBe('`output`: rows.\n\n```json\n{"output": []}\n```');
    const two = '```json\n{"output": []}\n```\nand\n```json\n[]\n```';
    expect((await generate(asked, { ai: scripted([two]), code: runner(() => ({})), generationFor, target })).result).toBe(two);
  });
});

describe('what ✨ is asked to write', () => {
  it('is previewed the same way, whichever it is', async () => {
    for (const write of ['body', 'example', 'output'] as const) {
      const preview = await generate({ element: 'code', prompt: 'x', inputs: ['a'], write, preview: true },
        { ai: scripted([]), code: runner(() => ({})), generationFor, target });
      expect(preview.calls, write).toHaveLength(1);
      expect(preview.calls[0].prompt, write).toContain('Prompt:\nx');
    }
  });

  it('is nothing it does not write', async () => {
    await expect(generate({ element: 'code', prompt: 'x', write: 'poem' as never }, { ai: scripted([]), code: runner(() => ({})), generationFor, target }))
      .rejects.toBeInstanceOf(GenerationRefused);
  });
});

describe('a sample that names one of the node\'s example files', () => {
  it('is read from them, and so is what the probe reads', async () => {
    const ai = scripted(['```js\nfunction run(i) { return { rows: i.csv.split("\\n").length }; }\n```']);
    let received: Record<string, unknown> = {};
    const code: CodeService = { run: async (_body, inputs) => { received = inputs; return { rows: 2 }; } };
    const examples = '## The example\n\n```json input\n{"csv": "example/rows.csv"}\n```\n\n```json expect\n{}\n```\n';
    const reply = await generate({
      element: 'code', prompt: 'Count the rows.', inputs: ['csv'], outputs: ['rows'], read_file_ports: ['csv'], examples,
      example_files: { 'example/rows.csv': 'name\nAda' },
    }, { ai, code, generationFor, target });
    expect(received).toEqual({ csv: 'name\nAda' });
    expect(ai.asked[0].prompt).toContain('sample, from the example "The example": "name\\nAda"');
    expect(reply.probe.status).toBe('ok');
  });
});

describe('a node run once per item', () => {
  /** A body run in this process: the probe and a run both reach it through `CodeService`, so they can be compared. */
  const inProcess: CodeService = {
    run: async (body, inputs) => new Function('inputs', `${body}\nreturn run(inputs);`)(inputs) as Record<string, unknown>,
  };
  const request = {
    element: 'code', prompt: 'Shout each word.', inputs: ['text'], outputs: ['out'],
    input_types: { text: 'text' }, batch_mode: 'per_item' as const,
    // As the editor sends them: which ports are declared lists (`Port.multi`).
    multi_inputs: ['text'], multi_outputs: ['out'],
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
    expect(reply.probe).toMatchObject({ status: 'ok' });
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
    expect(reply.probe).toMatchObject({ status: 'ok', problems: [] });
    // An output declared single hands on the bare answer, and an example that expects it is met by it.
    const typed = '## One word\n\n```json input\n{"text": "alpha"}\n```\n\n```json expect\n{"out": "ALPHA"}\n```\n';
    const single = await generate({ ...request, multi_outputs: [], sample_inputs: undefined, examples: typed }, { ai: scripted([shout]), code: inProcess, generationFor, target });
    expect(single.probe).toMatchObject({ status: 'ok' });
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

  it('cuts only the inputs the node declares lists', async () => {
    // Guessed from the types, as it once was, a list arriving on a port that
    // is not typed "list of" was cut as if it fanned out; a run hands it on whole.
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
      element: 'ai', prompt: 'Summarise each story.', inputs: ['story'], outputs: ['output'],
      input_types: { story: 'text' }, batch_mode: 'per_item', multi_inputs: ['story'], multi_outputs: ['output'],
      sample_inputs: { story: ['Once.', 'Twice.', 'Thrice.'] },
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
      { element: 'code', prompt: 'add', inputs: ['a'], outputs: ['out'], preview: true },
      { ai, code: runner(() => { throw new Error('nothing may run'); }), generationFor, target },
    );
    expect(ai.asked).toHaveLength(0);
    expect(reply.result).toBe('');
    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0].error).toBeNull();
    expect(reply.calls[0].prompt).toContain('const a = inputs["a"];');
    expect(reply.calls[0].system).toContain('expert software engineer');
  });

  it('is the same request the real call sends', async () => {
    const asked = { element: 'ai', prompt: 'Be brief.', inputs: ['prompt'] };
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
    element: 'code', prompt: 'count rows', inputs: ['csv', 'top'], outputs: ['rows'],
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
  it('takes the text between the tags, and not what the model says after them', async () => {
    const ai = scripted(['<system_prompt>Be terse.</system_prompt>\nBecause.']);
    const reply = await generate({ element: 'ai', prompt: 'a terse bot' }, { ai, code: runner(() => ({})), generationFor, target });
    expect(reply.result).toBe('Be terse.');
  });

  it('falls back to the whole reply when the model ignored the tags', async () => {
    const ai = scripted(['Just text.']);
    const reply = await generate({ element: 'ai', prompt: 'x' }, { ai, code: runner(() => ({})), generationFor, target });
    expect(reply.result).toBe('Just text.');
  });
});

describe('refusals and failures', () => {
  it('refuses an element that generates nothing, and a request that names no element', async () => {
    const deps = { ai: scripted([]), code: runner(() => ({})), generationFor, target };
    await expect(generate({ element: 'output', prompt: 'x' }, deps)).rejects.toBeInstanceOf(GenerationRefused);
    // A data node is its value: there is no format of it to write.
    await expect(generate({ element: 'data', prompt: 'x' }, deps)).rejects.toBeInstanceOf(GenerationRefused);
    // What arrives over the wire is not held to the type: a body without one.
    await expect(generate({ prompt: 'x' } as GenerateRequest, deps)).rejects.toBeInstanceOf(GenerationRefused);
  });

  it('hands the transcript back with a failure, since that is when it is worth reading', async () => {
    const ai: AiService = { complete: async () => { throw new Error('no content'); } };
    const failure = await generate({ element: 'code', prompt: 'x' }, { ai, code: runner(() => ({})), generationFor, target })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GenerationFailed);
    expect((failure as GenerationFailed).calls[0]).toMatchObject({ error: 'no content', reply: null });
  });
});

describe('a whole graph', () => {
  it('parses the fenced document and keeps the explanation', async () => {
    const ai = scripted(['```json\n{"metadata":{"name":"g"},"nodes":[],"edges":[]}\n```\nDone.']);
    const reply = await generateGraph('anything', { ai, target });
    expect(reply.graph).toEqual({ metadata: { name: 'g' }, nodes: [], edges: [] });
    expect(reply.explanation).toBe('Done.');
  });

  it('fails, with the transcript, when there is no document to parse', async () => {
    await expect(generateGraph('x', { ai: scripted(['no json here']), target })).rejects.toBeInstanceOf(GenerationFailed);
  });
});
