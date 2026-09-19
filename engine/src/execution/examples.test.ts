import { describe, it, expect } from 'vitest';
import { formatExample, parseExamples, runExamples, unmet } from './examples.ts';
import { registry } from '../elements/registry.ts';
import { parseGraph } from '../graph.ts';
import type { AiRequest, Runtime } from '../elements/Runtime.ts';

const fence = '```';
const section = (title: string, blocks: string[]) => `## ${title}\n\n${blocks.join('\n\n')}\n`;
const block = (info: string, body: string) => `${fence}${info}\n${body}\n${fence}`;

describe('parseExamples', () => {
  it('reads each titled section: its inputs, and what must come out or what a judge holds it to', () => {
    const { examples, problems } = parseExamples([
      '# Notes for people, ignored',
      section('Counts rows', [block('json input', '{ "input": "a\\nb" }'), 'Some prose.', block('json expect', '{ "output": 2 }')]),
      section('Sounds friendly', [block('json input', '{ "message": "hi" }'), block('judge', 'A friendly greeting.')]),
    ].join('\n'));
    expect(problems).toEqual([]);
    expect(examples).toEqual([
      { title: 'Counts rows', inputs: { input: 'a\nb' }, expect: { output: 2 } },
      { title: 'Sounds friendly', inputs: { message: 'hi' }, judge: 'A friendly greeting.' },
    ]);
  });

  it('says what is wrong with an example it cannot use, and uses the others', () => {
    const { examples, problems } = parseExamples([
      section('Broken', [block('json input', '{ nope }'), block('json expect', '{}')]),
      section('Checks nothing', [block('json input', '{ "input": 1 }')]),
      section('A list', [block('json input', '[1]'), block('json expect', '{ "output": 1 }')]),
      section('Fine', [block('json input', '{ "input": 1 }'), block('json expect', '{ "output": 1 }')]),
    ].join('\n'));
    expect(examples.map((example) => example.title)).toEqual(['Fine']);
    expect(problems).toEqual([
      expect.stringMatching(/"Broken": its input block is not valid JSON/),
      '"Broken": no ```json input block.',
      '"Checks nothing": no ```json expect or ```judge block, so nothing is checked.',
      '"A list": its input block must be an object keyed by port, like {"input": "…"}.',
      '"A list": no ```json input block.',
    ]);
  });

  it('reads back what formatExample writes', () => {
    const written = formatExample('From a run', { input: 'x' }, { output: [1, 2] });
    expect(parseExamples(written).examples).toEqual([{ title: 'From a run', inputs: { input: 'x' }, expect: { output: [1, 2] } }]);
  });
});

describe('unmet', () => {
  it('holds only the fields an expectation names', () => {
    expect(unmet({ rows: [{ Country: 'India' }] }, { rows: [{ Country: 'India', Population: 1 }], extra: true })).toEqual([]);
  });

  it('names the place that differs', () => {
    expect(unmet({ output: 2 }, { output: 3 })).toEqual(['output.output is 3; expected 2']);
    expect(unmet({ rows: [{}, {}] }, { rows: [{}] })).toEqual(['output.rows has 1 items; expected 2']);
    expect(unmet({ info: 'a' }, {})).toEqual(['output.info is missing']);
    expect(unmet({ nested: { deep: true } }, { nested: 'flat' })).toEqual(['output.nested is "flat"; expected an object']);
  });
});

describe('runExamples', () => {
  const judged: AiRequest[] = [];
  const runtime = (verdict = 'PASS\nFine.'): Runtime => ({
    files: { read: async () => '', write: async () => {}, list: async () => [], resolve: (p) => p, exists: async () => true },
    // The node doubles what it gets: enough to be right on one example and wrong on another.
    code: { run: async (_body, inputs) => ({ output: Number(inputs.input) * 2 }) },
    ai: { complete: async (request) => { judged.push(request); return verdict; } },
  });
  const graphWith = (type: 'code' | 'ai', examples: string, config: Record<string, unknown> = {}) => parseGraph({
    metadata: { name: 't' },
    nodes: [{
      id: 'n', node_type: type, label: 'N',
      inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'any' }],
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'any' }],
      config: { code: 'function run() {}', system_prompt: 'Answer.', examples, ...config },
    }],
    edges: [],
  });
  const one = (title: string, input: number, output: number) =>
    section(title, [block('json input', JSON.stringify({ input })), block('json expect', JSON.stringify({ output }))]);

  it('passes what matches, fails what does not, and says how', async () => {
    const results = await runExamples(graphWith('code', one('Two', 1, 2) + one('Wrong', 2, 5)), 'n', { runtime: runtime(), registry });
    expect(results).toEqual([
      { title: 'Two', status: 'pass', details: [], outputs: { output: 2 } },
      { title: 'Wrong', status: 'fail', details: ['output.output is 4; expected 5'], outputs: { output: 4 } },
    ]);
  });

  it('fails an example whose output breaks the node\'s kept output interface', async () => {
    const graph = graphWith('code', section('Any', [block('json input', '{ "input": 1 }'), block('judge', 'Anything.')]), {
      output_schema: { type: 'object', properties: { output: { type: 'string' } } },
    });
    const [result] = await runExamples(graph, 'n', { runtime: runtime(), registry });
    expect(result.status).toBe('fail');
    expect(result.details).toEqual(['breaks its output interface: output.output is integer; the interface says string']);
  });

  it('asks a model to judge a sentence, and fails on its FAIL', async () => {
    judged.length = 0;
    const examples = section('Friendly', [block('json input', '{ "input": 1 }'), block('judge', 'A number above one.')]);
    const [passed] = await runExamples(graphWith('code', examples), 'n', { runtime: runtime(), registry });
    expect(passed.status).toBe('pass');
    expect(judged[0].prompt).toContain('A number above one.');
    expect(judged[0].prompt).toContain('"output": 2');
    const [failed] = await runExamples(graphWith('code', examples), 'n', { runtime: runtime('FAIL\nIt is not above one.'), registry });
    expect(failed).toMatchObject({ status: 'fail', details: ['judged: It is not above one.'] });
  });

  it('offline, skips what needs a model: an AI node, and a judged-only example', async () => {
    const judgedOnly = section('Judged', [block('json input', '{ "input": 1 }'), block('judge', 'Anything.')]);
    expect((await runExamples(graphWith('code', judgedOnly), 'n', { runtime: runtime(), registry, offline: true }))[0].status).toBe('skipped');
    expect((await runExamples(graphWith('ai', one('Asks', 1, 2)), 'n', { runtime: runtime(), registry, offline: true }))[0].status).toBe('skipped');
  });

  it('reports examples it cannot read as errors, not as passes', async () => {
    const results = await runExamples(graphWith('code', section('Broken', [block('json input', '{')])), 'n', { runtime: runtime(), registry });
    expect(results.every((result) => result.status === 'error')).toBe(true);
  });
});
