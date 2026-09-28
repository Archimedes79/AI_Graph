import { describe, it, expect } from 'vitest';
import type { AiRequest, AiService, CodeService } from '../../elements/Runtime.ts';
import { registry } from '../../elements/registry.ts';
import { parseWidget } from '../../elements/nodes/gui/GuiNodeRunner.ts';
import { parseGraph, type GraphNode } from '../../graph.ts';
import { STANDARD_PROMPTS } from '../../authoring/prompts.ts';
import { GenerationFailed, GenerationRefused, firstCodeBlock, generate, generateGraph } from './generate.ts';
import { nodeCode } from '../node.ts';
import type { GenerateRequest } from '../api.ts';

/**
 * Writing a node's files with a model, without a model.
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

const target = { provider: 'test', model: 'm' };
const deps = (ai: AiService, code: CodeService = runner(() => ({}))) => ({ ai, code, elements: registry, target });

const port = (id: string, kind: 'input' | 'output', extra: Record<string, unknown> = {}) =>
  ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '', ...extra });

/** A node as the editor sends it: its kind, heading and text, its ports, its definitions and body in *config*. */
function node(type: string, config: Record<string, unknown> = {}, ports: { inputs?: string[]; outputs?: string[] } = {}): GraphNode {
  return parseGraph({
    metadata: { name: 't' },
    nodes: [{
      id: 'n', node_type: type, label: 'Count', description: 'Count the lines of the text.',
      inputs: (ports.inputs ?? ['text']).map((id) => port(id, 'input')),
      outputs: (ports.outputs ?? ['lines']).map((id) => port(id, 'output')),
      config,
    }],
    edges: [],
  }).nodes[0];
}

const INPUT = 'module.exports = { "text": "a\\nb" };';
const OUTPUT = 'module.exports = { "lines": 2 };';
const js = (body: string) => `\`\`\`js\n${body}\n\`\`\``;

describe('code', () => {
  it('is asked for against the skeleton, typed by its definitions, and kept from the fence', async () => {
    const ai = scripted([`${js('function run(inputs) { return { lines: 1 }; }')}\nIt counts.`]);
    const reply = await generate({ node: node('code') }, deps(ai));
    expect(reply.result).toBe('function run(inputs) { return { lines: 1 }; }');
    // Nothing to try it on: it has an input, and no input.js.
    expect(reply.probe.status).toBe('skipped');
    expect(ai.asked[0].prompt).toContain("@param {import('./input.js').Input} inputs");
    expect(ai.asked[0].prompt).toContain('const text = inputs["text"];');
    expect(ai.asked[0].prompt).toContain('The returned object\'s keys must be exactly: ["lines"]');
    // The empty window as well as the full one: the code is not optional about it.
    expect(ai.asked[0].prompt).toContain('Handle an input that is missing or empty as well as a full one: then the output says what to do instead of failing');
    expect(reply.calls).toHaveLength(1);
    expect(reply.calls[0]).toMatchObject({ provider: 'test', model: 'm', reply_chars: expect.any(Number) });
  });

  it('is tried on the example in input.js, and held to output.js', async () => {
    const ai = scripted([js('function run(i) { return { lines: i.text.split("\\n").length }; }')]);
    const reply = await generate({ node: node('code', { input_definition: INPUT, output_definition: OUTPUT }) }, deps(ai, nodeCode));
    expect(reply.probe).toEqual({ status: 'ok', error: '', problems: [] });
  }, 30_000);

  it('is repaired once, with the evidence, when what it returns does not fit', async () => {
    const ai = scripted([
      js('function run(i) { return { lines: String(i.text.split("\\n").length) }; }'),
      js('function run(i) { return { lines: i.text.split("\\n").length }; }'),
    ]);
    const reply = await generate({ node: node('code', { input_definition: INPUT, output_definition: OUTPUT }) }, deps(ai, nodeCode));
    expect(reply.probe.status).toBe('repaired');
    expect(ai.asked[1].prompt).toContain('--- what is wrong with what it returned ---');
    expect(ai.asked[1].prompt).toContain('- output "lines" is text; output.js says a number');
    expect(ai.asked[1].prompt).toContain('inputs["text"]: string = "a\\nb"');
    expect(reply.result).toContain('i.text.split("\\n").length }');
  }, 30_000);

  it('keeps the attempt that got further when the repair is no better, and says what remains', async () => {
    const ai = scripted([
      js('function run() { return { lines: "two" }; }'),
      js('function run() { throw new Error("worse"); }'),
    ]);
    const reply = await generate({ node: node('code', { input_definition: INPUT, output_definition: OUTPUT }) }, deps(ai, nodeCode));
    expect(reply.probe).toMatchObject({ status: 'failed', problems: ['output "lines" is text; output.js says a number'] });
    expect(reply.result).toContain('"two"');
  }, 30_000);

  it('is not said to fit an output.js that cannot be read -- and is not "repaired" for it: the code cannot mend the file', async () => {
    const ai = scripted([js('function run(i) { return { lines: i.text.split("\\n").length }; }')]);
    const reply = await generate({ node: node('code', { input_definition: INPUT, output_definition: 'module.exports = { "lines": 2, };' }) }, deps(ai, nodeCode));
    expect(reply.probe).toMatchObject({ status: 'failed', error: '', problems: [expect.stringMatching(/^output\.js cannot be read: /)] });
    expect(ai.asked).toHaveLength(1);
  }, 30_000);

  it('leaves the error port to the executor: a body is neither asked for it nor held to it', async () => {
    const ai = scripted([js('function run(i) { return { lines: 2 }; }')]);
    const reply = await generate({ node: node('code', { input_definition: INPUT, catch_errors: true }, { outputs: ['lines', 'error'] }) }, deps(ai, nodeCode));
    expect(ai.asked[0].prompt).toContain('must be exactly: ["lines"]');
    expect(reply.probe.status).toBe('ok');
  }, 30_000);

  it('is written for one call of a node run once per item, and tried on the one item its example is', async () => {
    const ai = scripted([js('function run(i) { return { lines: i.text.length }; }')]);
    const item = node('code', { input_definition: 'module.exports = { "text": "one" };', batch_mode: 'per_item' });
    item.inputs[0].multi = true;
    const reply = await generate({ node: item }, deps(ai, nodeCode));
    expect(ai.asked[0].prompt).toContain('`run` is called once per item');
    expect(reply.probe.status).toBe('ok');
  }, 30_000);

  it('that asks a model is tried with a node it can ask', async () => {
    // First reply: the code. Second: what the code's own question is answered with, in the probe.
    const ai = scripted([
      js('async function run(inputs, node) { return { label: (await node.llm({ prompt: "Classify: " + inputs.row })).trim() }; }'),
      ' fruit ',
    ]);
    const reply = await generate({
      node: node('code', { input_definition: 'module.exports = { "row": "apple" };', output_definition: 'module.exports = { "label": "fruit" };' }, { inputs: ['row'], outputs: ['label'] }),
    }, deps(ai, nodeCode));
    expect(reply.probe.status).toBe('ok');
    expect(ai.asked[1].prompt).toContain('Classify: apple');
  }, 30_000);
});

describe('the prompt ✨ is sent', () => {
  it('is the standard one for what it writes, its variables filled, and the frame after it', async () => {
    const ai = scripted([js('function run() { return { lines: 1 }; }')]);
    await generate({ node: node('code'), context: 'Graph: Lines\nNodes: n (code) "Count"' }, deps(ai));
    const sent = ai.asked[0].prompt;
    expect(sent.startsWith('This is the user\'s node description:\n# Count (ID n, code node)\n\nCount the lines of the text.')).toBe(true);
    expect(sent).toContain('Context:\nGraph: Lines\nNodes: n (code) "Count"');
    expect(sent).toContain(STANDARD_PROMPTS.code.split('\n').at(-1)!);
    expect(sent.indexOf('## How to answer')).toBeGreaterThan(sent.indexOf('Task: write the code'));
  });

  it('is the node\'s own where someone changed it: exact names filled, any other brace as written', async () => {
    const ai = scripted([js('function run() { return { lines: 1 }; }')]);
    const mine = node('code', { prompts: { body: 'Mine: {Node Description}\nKeep {"a": 1} and {Nope}.' } });
    await generate({ node: mine }, deps(ai));
    expect(ai.asked[0].prompt.startsWith('Mine: # Count (ID n, code node)\n\nCount the lines of the text.\nKeep {"a": 1} and {Nope}.\n\n## How to answer')).toBe(true);
  });

  it('says what arrives from the wiring while there is no input.js, and what is wanted while there is no output.js', async () => {
    const ai = scripted([js('function run() { return { lines: 1 }; }')]);
    const reading = node('code');
    reading.inputs[0].data_type = 'file_path';
    await generate({
      node: reading,
      input_sources: { text: '"Page" (port "CSV file")' },
      output_targets: { lines: '"Page" (port "chart"), which wants what to plot' },
    }, deps(ai));
    const sent = ai.asked[0].prompt;
    expect(sent).toContain('Input definition:\nNone yet. Its inputs, as wired:\n- `text` (a path: the node reads the file there, and is handed its text)\n  from "Page" (port "CSV file")');
    expect(sent).toContain('Output definition:\nNone yet. Its outputs, as wired:\n- `lines`\n  to "Page" (port "chart"), which wants what to plot');
    expect(sent).toContain('"text" is handed the file\'s text, already read');
  });

  it('sends the definitions as the files say them, and what is wired after each', async () => {
    const ai = scripted([js('function run() { return { lines: 1 }; }')]);
    await generate({ node: node('code', { input_definition: INPUT, output_definition: OUTPUT }) }, deps(ai));
    expect(ai.asked[0].prompt).toContain(`Input definition:\n${INPUT}\n\nIts inputs, as wired:\n- \`text\`\n  not wired yet`);
    expect(ai.asked[0].prompt).toContain(`Output definition:\n${OUTPUT}\n\nIts outputs, as wired:\n- \`lines\`\n  not wired yet`);
  });

  it('no longer tells every code node what a chart takes -- only a chart downstream says so', async () => {
    const ai = scripted([js('function run() { return { lines: 1 }; }')]);
    await generate({ node: node('code') }, deps(ai));
    expect(ai.asked[0].prompt).not.toContain('draws at the block');
    expect(ai.asked[0].prompt).not.toContain('what to plot');
    expect(registry.widget('plot_window')?.receives(parseWidget({ id: 'b', kind: 'plot_window' }))).toContain('draws at the block\'s real size');
  });
});

describe('an input definition', () => {
  it('is written from the example file, read here when the request brings only its path, and is not run', async () => {
    const ai = scripted([js('/** @typedef {Object} Input @property {string} text a text */\nmodule.exports = { "text": "a\\nb" };')]);
    const files = { resolve: (p: string) => p, exists: async () => true, read: async () => 'name,age\nAda,36', write: async () => {}, list: async () => [] };
    const reply = await generate({ node: node('code'), write: 'input', input_files: [{ path: 'data/people.csv' }] }, { ...deps(ai), files });
    expect(reply.result).toBe('/** @typedef {Object} Input @property {string} text a text */\nmodule.exports = { "text": "a\\nb" };');
    expect(reply.probe.status).toBe('skipped');
    expect(ai.asked[0].prompt).toContain('Example files:\ndata/people.csv:\nname,age\nAda,36');
    expect(ai.asked[0].prompt).toContain('Answer with the whole file input.js');
    expect(ai.asked[0].prompt).toContain('for each input -- "text" --');
  });

  it('is asked again, once, where its example cannot be read or names another input', async () => {
    const ai = scripted([js('module.exports = { text: "a" };'), js('module.exports = { "text": "a" };')]);
    const reply = await generate({ node: node('code'), write: 'input' }, deps(ai));
    expect(reply.result).toBe('module.exports = { "text": "a" };');
    expect(ai.asked[1].prompt).toContain('It cannot be used as it is: Its example cannot be read');
    const stray = scripted([js('module.exports = { "txt": "a" };'), js('module.exports = { "txt": "b" };')]);
    expect((await generate({ node: node('code'), write: 'input' }, deps(stray))).probe)
      .toMatchObject({ status: 'failed', problems: ['It names "txt", which is not among the inputs: "text".'] });
  });

  it('says there are no example files where there are none', async () => {
    const ai = scripted([js('module.exports = { "text": "a" };')]);
    await generate({ node: node('code'), write: 'input' }, deps(ai));
    expect(ai.asked[0].prompt).toContain('Example files:\nNone.');
  });

  it('is shown the shape it is written in, the keys in double quotes -- not only told "plain JSON"', async () => {
    const ai = scripted([js('module.exports = { "text": "a", "top": 3 };')]);
    await generate({ node: node('code', {}, { inputs: ['text', 'top'] }), write: 'input' }, deps(ai));
    const sent = ai.asked[0].prompt;
    expect(sent).toContain('shaped like this:\n\n/** @typedef {Object} Input @property {…} text … @property {…} top … */\nmodule.exports = { "text": …, "top": … };\n\n');
    expect(sent).toContain('as plain JSON: double-quoted keys and strings, no comments, no trailing commas.');
  });

  it('is told what the graph hands it -- a data node\'s value -- and to follow it, so the keys are not made up', async () => {
    // Tool 3 of the review: capitals held by a data node, sorted by a code node into a table. Told only
    // "Example files: None.", ✨ Input wrote Capital/Country/Population, and the table got one empty row.
    const held = '"Capitals" (port "output"), which hands on: structure: Ten European capitals with their population -- '
      + 'it holds: [{"capital":"Paris","country":"France","population":2102650},{"capital":"Rome","country":"Italy","population":2749031}]';
    const ai = scripted([js('module.exports = { "input": [{ "capital": "Paris", "country": "France", "population": 2102650 }] };')]);
    await generate({ node: node('code', {}, { inputs: ['input'], outputs: ['output'] }), write: 'input', input_sources: { input: held } }, deps(ai));
    const sent = ai.asked[0].prompt;
    expect(sent).toContain(`Its input definition, and what the graph hands it:\nNone yet. Its inputs, as wired:\n- \`input\`\n  from ${held}`);
    expect(sent).toContain('Follow what is wired where it says what arrives');
  });
});

describe('an output definition', () => {
  it('is written from the files it is given, a spec among them', async () => {
    const ai = scripted([js('module.exports = { "lines": 2 };')]);
    await generate({ node: node('code'), write: 'output', output_files: [{ path: 'spec.md', text: 'Lines: a count.' }] }, deps(ai));
    expect(ai.asked[0].prompt).toContain('Output files:\nspec.md:\nLines: a count.');
  });

  it('is told what the nodes it feeds want -- a chart\'s figure -- and to give exactly that, also where output.js is written already', async () => {
    // Tool 1 of the review: a CSV charted. ✨ Output was told the chart's size only, wrote a chart
    // library's config ({data, labels, type}), and pressed again rewrote that file without a word of the figure.
    const wants = registry.widget('plot_window')!.receives(parseWidget({ id: 'plot_window', kind: 'plot_window' }))!;
    const configured = 'module.exports = { "output": { "data": [1450], "labels": ["India"], "type": "bar" } };';
    const ai = scripted([js('module.exports = { "output": { "kind": "bars", "title": "Population", "points": [{ "label": "India", "value": 1450 }] } };')]);
    await generate({
      node: node('code', { input_definition: 'module.exports = { "input": "Country,Population\\nIndia,1450" };', output_definition: configured }, { inputs: ['input'], outputs: ['output'] }),
      write: 'output',
      output_targets: { output: `"Page" (port "Chart"), which wants ${wants}` },
    }, deps(ai));
    const sent = ai.asked[0].prompt;
    expect(wants).toContain('a figure {"kind": "bars"|"columns"|"line"|"donut", "title": string, "points": [...]}');
    expect(sent).toContain(`Its output definition, and what the nodes it feeds want:\n${configured}\n\nIts outputs, as wired:\n- \`output\`\n  to "Page" (port "Chart"), which wants ${wants}`);
    expect(sent).toContain('a chart that wants a figure {kind, title, points} gets exactly that');
  });

  it('is written keeping the outputs other nodes are wired to, and asked again where it drops one', async () => {
    const ai = scripted([js('module.exports = { "count": 2 };'), js('module.exports = { "lines": 2 };')]);
    const reply = await generate({ node: node('code', { input_definition: INPUT }), write: 'output', output_targets: { lines: '"Page"' } }, deps(ai));
    expect(ai.asked[0].prompt).toContain('Now it has "lines". Keep "lines": it is wired to other nodes, which read it by that id.');
    expect(ai.asked[1].prompt).toContain('It leaves out "lines", which other nodes are wired to');
    expect(reply.result).toBe('module.exports = { "lines": 2 };');
  });

  it('names one output for each thing the description asks the node to hand on, and is shown the shape in double quotes', async () => {
    // Tool 2 of the review: "say its mood in one word, and the reason" kept the one output "output".
    const ai = scripted([js('module.exports = { "mood": "calm", "reason": "It says so." };')]);
    const mood = { ...node('ai', {}, { inputs: ['prompt'], outputs: ['output'] }), description: 'Read the text and say its mood in one word, and the reason in one line.' };
    await generate({ node: mood, write: 'output' }, deps(ai));
    const sent = ai.asked[0].prompt;
    expect(sent).toContain('/** @typedef {Object} Output @property {…} output … */\nmodule.exports = { "output": … };');
    expect(sent).toContain('one for each thing the description asks it to hand on -- "its mood, and the reason" are two outputs, "mood" and "reason".');
    expect(sent).toContain('Now it has "output", and nothing is wired to it yet: name each by what it holds.');
    expect(sent).toContain('as plain JSON: double-quoted keys and strings, no comments, no trailing commas.');
  });
});

describe('an ai node\'s instructions', () => {
  it('are prompt.md, with the placeholders filled when it runs, and the answer JSON where its output.js names a value that is not text', async () => {
    const ai = scripted(['```md\n{Node Description}\n\nAnswer with {Output Definition}\n```']);
    const reply = await generate({ node: node('ai', { output_definition: OUTPUT }, { inputs: ['text', 'topic'] }) }, deps(ai));
    expect(reply.result).toBe('{Node Description}\n\nAnswer with {Output Definition}');
    const sent = ai.asked[0].prompt;
    expect(sent).toContain('each input under its port id: "text", "topic"');
    expect(sent).toContain('Put {Node Description} and {Output Definition} where they belong');
    expect(sent).toContain('The answer is parsed as a JSON object keyed as the output definition\'s example is');
    expect(ai.asked[0].system).toMatch(/prompt engineer/);
  });

  it('are plain text without an output.js, and where it names one output that holds text', async () => {
    const ai = scripted(['```md\nSay it.\n```', '```md\nSum it up.\n```']);
    await generate({ node: node('ai') }, deps(ai));
    expect(ai.asked[0].prompt).toContain('The answer is plain text, handed on as it is on "output": ask for the text itself.');
    await generate({ node: node('ai', { output_definition: 'module.exports = { "summary": "Two sentences." };' }, { outputs: ['summary'] }) }, deps(ai));
    expect(ai.asked[1].prompt).toContain('The answer is plain text, handed on as it is on "summary": ask for the text itself, as the output definition describes it -- not JSON');
    expect(ai.asked[1].prompt).not.toContain('parsed as a JSON object');
  });
});

describe('a data node\'s data', () => {
  it('is written as JSON where it holds structure, and refused where the model wrote none', async () => {
    const held = node('data', { data_format: 'structure' }, { inputs: ['input'], outputs: ['output'] });
    const ai = scripted(['```json\n{"count": 0}\n```']);
    const reply = await generate({ node: held }, deps(ai));
    expect(reply.result).toBe('{"count": 0}');
    expect(ai.asked[0].prompt).toContain('Answer with what the node holds, in one ```json block, as plain JSON, and nothing else.');
    await expect(generate({ node: held }, deps(scripted(['```json\n{count: 0}\n```'])))).rejects.toThrow(/not JSON/);
  });

  it('is the text itself where it holds text -- asked for as text, and told what it feeds without a word of definitions it has none of', async () => {
    const ai = scripted(['```text\nDear reader,\n```']);
    const reply = await generate({
      node: node('data', { data_format: 'text' }, { inputs: ['input'], outputs: ['output'] }),
      output_targets: { output: '"Letter" (port "greeting")' },
    }, deps(ai));
    expect(reply.result).toBe('Dear reader,');
    expect(ai.asked[0].prompt).toContain('What it feeds:\n- `output`\n  to "Letter" (port "greeting")\n\nContext:');
    expect(ai.asked[0].prompt).not.toContain('None yet');
    expect(ai.asked[0].prompt).toContain('Answer with what the node holds, in one ```text block, the text itself, and nothing else.');
  });
});

describe('changing a body there is (refine)', () => {
  it('writes code from the function as it is, what it returned and what to change -- and restates the text with it', async () => {
    const ai = scripted([`${js('function run(i) { return { lines: i.text.split("\\n").length + 1 }; }')}\n<description>Count the lines, plus one.</description>`]);
    const reply = await generate({
      node: node('code', { input_definition: INPUT, code: 'function run(i) { return { lines: 2 }; }' }),
      refine: { change: 'Add one.', outcome: '{"lines": 2}' },
    }, deps(ai, nodeCode));
    const sent = ai.asked[0].prompt;
    expect(sent).toContain('--- the function as it is now ---\nfunction run(i) { return { lines: 2 }; }');
    expect(sent).toContain('--- what it returned on its example ---\n{"lines": 2}');
    expect(sent).toContain('--- what to change ---\nAdd one.');
    expect(reply.description).toBe('Count the lines, plus one.');
    expect(reply.result).not.toContain('<description>');
  }, 30_000);

  it('brings no text back where no change was asked, whatever the model offered: ✨ Fix repairs from how it failed', async () => {
    const ai = scripted([`${js('function run(i) { return { lines: 2 }; }')}\n<description>Something else.</description>`]);
    const reply = await generate({
      node: node('code', { input_definition: INPUT, code: 'function run() { throw new Error("boom"); }' }),
      refine: { error: 'boom' },
    }, deps(ai, nodeCode));
    expect(ai.asked[0].prompt).toContain('--- the error it raised ---\nboom');
    expect(reply.description).toBeUndefined();
  }, 30_000);

  it('writes instructions again whole from the ones there are, with the text restated', async () => {
    const ai = scripted(['```md\nBe brief, and kind.\n```\n<description>Answers briefly and kindly.</description>']);
    const reply = await generate({ node: node('ai', { prompt: 'Be brief.' }), refine: { change: 'Be kind too.', outcome: 'ok.' } }, deps(ai));
    expect(ai.asked[0].prompt).toContain('## The instructions (prompt.md) as it is now\n\nBe brief.');
    expect(ai.asked[0].prompt).toContain('## What to change\n\nBe kind too.');
    // Asked for the restated text after the block, and not also for the block "and nothing else".
    expect(ai.asked[0].prompt).toContain('in one ```md block, then the node\'s text restated as asked above, and nothing else');
    expect(`${ai.asked[0].system} ${ai.asked[0].prompt}`).not.toMatch(/block and nothing else|Output only/);
    expect(reply).toMatchObject({ result: 'Be brief, and kind.', description: 'Answers briefly and kindly.' });
  });

  it('writes what a data node holds again whole, changed as said, with the text restated -- the bar\'s change of a data node', async () => {
    const ai = scripted(['Here:\n```json\n{"cities": ["Berlin", "Paris"]}\n```\n<description>Keeps two capitals: Berlin and Paris.</description>']);
    const held = node('data', { data_format: 'structure', data_value: { cities: ['Berlin'] } }, { inputs: ['input'], outputs: ['output'] });
    const reply = await generate({ node: held, write: 'body', refine: { change: 'Add Paris.' } }, deps(ai));
    const { prompt, system } = ai.asked[0];
    expect(prompt).toContain('## What the node holds as it is now\n\n{\n  "cities": [\n    "Berlin"\n  ]\n}');
    expect(prompt).toContain('## What to change\n\nAdd Paris.');
    expect(prompt).toMatch(/restate what this node does in one or two sentences, inside <description><\/description> tags/);
    expect(prompt).toContain('in one ```json block, as plain JSON -- then, after the block, the node\'s text restated as asked above, and nothing else.');
    expect(`${system} ${prompt}`).not.toMatch(/JSON, and nothing else|Output only/);
    expect(reply).toMatchObject({ result: '{"cities": ["Berlin", "Paris"]}', description: 'Keeps two capitals: Berlin and Paris.' });
    // Written anew, with nothing to change, it is the data and nothing else.
    const fresh = scripted(['```json\n{"cities": []}\n```']);
    await generate({ node: held }, deps(fresh));
    expect(fresh.asked[0].prompt).toContain('in one ```json block, as plain JSON, and nothing else.');
  });
});

describe('the code in a model\'s answer', () => {
  const fence = '```';
  it('is found behind any info string, with Windows line ends too', () => {
    expect(firstCodeBlock(`Here:\n${fence}javascript \nfunction run() {}\n${fence}\nDone.`)).toBe('function run() {}');
    expect(firstCodeBlock(`${fence}js title="code.js"\r\nfunction run() {}\r\n${fence}`)).toBe('function run() {}');
  });

  it('does not end at a fence the code writes into a string', () => {
    const code = 'function run() {\n  return { md: "' + fence + 'json\\n{}\\n' + fence + '" };\n}';
    expect(firstCodeBlock(`${fence}js\n${code}\n${fence}`)).toBe(code);
  });
});

describe('a preview', () => {
  it('builds the request exactly as ✨ would, whichever it writes, and does not send it', async () => {
    for (const write of ['input', 'output', 'body'] as const) {
      const ai = scripted([]);
      const reply = await generate({ node: node('code'), write, preview: true }, deps(ai));
      expect(ai.asked, write).toHaveLength(0);
      expect(reply.calls, write).toHaveLength(1);
      expect(reply.calls[0], write).toMatchObject({ reply: null, error: null });
      expect(reply.calls[0].prompt, write).toContain('## How to answer');
    }
  });
});

describe('refusals and failures', () => {
  it('refuses a node that has nothing ✨ writes, a definition of a node that has none, and what it does not write', async () => {
    const quiet = deps(scripted([]));
    await expect(generate({ node: node('output') }, quiet)).rejects.toBeInstanceOf(GenerationRefused);
    await expect(generate({ node: node('data'), write: 'input' }, quiet)).rejects.toBeInstanceOf(GenerationRefused);
    await expect(generate({ node: node('code'), write: 'example' as never }, quiet)).rejects.toBeInstanceOf(GenerationRefused);
    // What arrives over the wire is not held to the type: a request without a node.
    await expect(generate({} as GenerateRequest, quiet)).rejects.toBeInstanceOf(GenerationRefused);
  });

  it('hands the transcript back with a failure, since that is when it is worth reading', async () => {
    const ai: AiService = { complete: async () => { throw new Error('no content'); } };
    const failure = await generate({ node: node('code') }, deps(ai)).catch((error: unknown) => error);
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

  it('fails, with the transcript and a sentence for a person, when there is no whole document to parse -- an answer cut off', async () => {
    const failure = await generateGraph('x', { ai: scripted(['```json\n{"nodes": [{"id": "a", "config": {"history": "## 2026']), target })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GenerationFailed);
    expect((failure as GenerationFailed).message).toBe('The model\'s answer was not a whole graph -- it may have been cut off. Try again, or ask for less at once.');
    expect((failure as GenerationFailed).calls).toHaveLength(1);
  });
});

describe('a whole graph, changed as said', () => {
  const current = parseGraph({
    metadata: { name: 'Word tool', description: 'Counts words.', gui_scheme: 'paper' },
    nodes: [
      { id: 'count', node_type: 'code', label: 'Count', position: { x: 420, y: 120 }, config: { code: 'function run() { return {}; }' } },
      { id: 'page', node_type: 'gui', label: 'Page', position: { x: 40, y: 80 }, width: 340, height: 300 },
    ],
    edges: [],
  });

  it('is sent the graph there is, as the document the model writes, with the change -- and asked to keep the ids', async () => {
    const ai = scripted(['```json\n{"nodes":[],"edges":[]}\n```']);
    await generateGraph('Call the counter "Count words".', { ai, target }, current);
    const { prompt, system } = ai.asked[0];
    // The document itself, so a model shown it can hand it back whole.
    expect(prompt).toContain(JSON.stringify(current, null, 2));
    expect(prompt).toContain('Change it as follows:\nCall the counter "Count words".');
    expect(prompt).toMatch(/Keep every node's id, and keep everything the change does not touch/);
    // The rules a designed graph is held to hold for a changed one: the kinds, their settings, the derived ports.
    expect(system).toContain('Graph DSL');
  });

  it('keeps what the answer leaves out: the graph\'s name and scheme, where each node stands, a page\'s size', async () => {
    // An answer that says nothing of the metadata, of positions or of a size.
    const answer = {
      nodes: [
        { id: 'count', node_type: 'code', label: 'Count words' },
        { id: 'page', node_type: 'gui', label: 'Page' },
        { id: 'shown', node_type: 'output', label: 'Words', position: { x: 800, y: 120 } },
      ],
      edges: [],
    };
    const reply = await generateGraph('Show the count.', { ai: scripted([`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``]), target }, current);
    const graph = parseGraph(reply.graph);
    expect(graph.metadata).toMatchObject({ name: 'Word tool', description: 'Counts words.', gui_scheme: 'paper' });
    expect(graph.nodes.map((node) => [node.id, node.label, node.position])).toEqual([
      ['count', 'Count words', { x: 420, y: 120 }], ['page', 'Page', { x: 40, y: 80 }], ['shown', 'Words', { x: 800, y: 120 }],
    ]);
    expect(graph.nodes[1]).toMatchObject({ width: 340, height: 300 });
    // What the answer does say is what it says: a new name is a change.
    const renamed = await generateGraph('Rename it.', {
      ai: scripted(['```json\n{"metadata":{"name":"Counter"},"nodes":[],"edges":[]}\n```']), target,
    }, current);
    expect(parseGraph(renamed.graph).metadata).toMatchObject({ name: 'Counter', gui_scheme: 'paper' });
  });

  it('designs one when the graph there is has no nodes yet, under the name it has when the design gives none', async () => {
    const ai = scripted(['```json\n{"nodes":[],"edges":[]}\n```']);
    const empty = parseGraph({ metadata: { name: 'My tool', gui_scheme: 'office' }, nodes: [], edges: [] });
    const reply = await generateGraph('Count the words of a text.', { ai, target }, empty);
    expect(ai.asked[0].prompt).toBe('Design a graph that does the following:\nCount the words of a text.');
    expect(parseGraph(reply.graph).metadata).toMatchObject({ name: 'My tool', gui_scheme: 'office' });
  });

  it('is not sent how each node was written, and loses none of it: a kept node\'s history comes back from the graph that was sent', async () => {
    const written = parseGraph({
      metadata: { name: 'Words' },
      nodes: [
        { id: 'count', node_type: 'code', label: 'Count', description: 'Counts the words.', config: {
          code: 'function run() { return {}; }', prompts: { body: 'Mine.' },
          history: '## 2026-09-27 10:00 · ✨ Code\n\nPrompt:\n\n```\nIBAN DE00 1234\n```',
        } },
        { id: 'say', node_type: 'ai', label: 'Say', description: 'Says the count.', config: {
          prompt: 'Say it.', history: '## 2026-09-27 11:00 · ✨ Prompt\n\nNothing was sent.',
        } },
      ],
      edges: [],
    });
    // "say" changed, "note" new -- and a history the model made up for "count", which is not the node's.
    const answer = {
      nodes: [
        { id: 'count', node_type: 'code', label: 'Count', description: 'Counts the words.', config: { code: 'function run() { return {}; }', history: 'made up' } },
        { id: 'say', node_type: 'ai', label: 'Say', description: 'Says the count kindly.', config: { prompt: 'Say it kindly.' } },
        { id: 'note', node_type: 'data', label: 'Note', description: 'Keeps a note.', config: { data_format: 'text', data_value: 'hi' } },
      ],
      edges: [],
    };
    const ai = scripted([`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``]);
    const reply = await generateGraph('Say it kindly, and keep a note.', { ai, target }, written);
    expect(ai.asked[0].prompt).not.toMatch(/IBAN|Mine\.|✨ Prompt/);
    const [count, say, note] = parseGraph(reply.graph).nodes;
    // Kept and untouched: its history and its ✨ prompts, as they were sent.
    expect(count.config).toMatchObject({ history: written.nodes[0].config.history, prompts: { body: 'Mine.' } });
    // Touched: the exchange at the end of its history, as after every ✨; new: its history begins with it.
    const exchange = /## \d{4}-\d\d-\d\d \d\d:\d\d · Change of the graph: Say it kindly, and keep a note\.\n\n### Sent to test m\n\nSystem:/;
    expect(String(say.config.history)).toMatch(new RegExp(`^## 2026-09-27 11:00 · ✨ Prompt\\n\\nNothing was sent\\.\\n\\n${exchange.source}`));
    expect(String(note.config.history)).toMatch(new RegExp(`^${exchange.source}`));
  });

  it('keeps the history of the nodes inside a node that holds a graph', async () => {
    const inner = (config: Record<string, unknown>) => ({
      metadata: { name: 'inside' }, edges: [],
      nodes: [{ id: 'count', node_type: 'code', label: 'Count', description: 'Counts the words.', config: { code: 'x', ...config } }],
    });
    const sent = parseGraph({ metadata: { name: 'Outer' }, nodes: [{ id: 'part', node_type: 'subgraph', label: 'Part', config: { subgraph: inner({ history: 'the history inside' }) } }], edges: [] });
    const answer = { nodes: [{ id: 'part', node_type: 'subgraph', label: 'Part, renamed', config: { subgraph: inner({}) } }], edges: [] };
    const ai = scripted([`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``]);
    const reply = await generateGraph('Rename the part.', { ai, target }, sent);
    expect(ai.asked[0].prompt).not.toContain('the history inside');
    const [part] = parseGraph(reply.graph).nodes;
    expect(registry.node('subgraph')!.nestedGraph(part)!.nodes[0].config.history).toBe('the history inside');
  });
});
