import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiRequest, AiService, CodeRunner } from '../../element.ts';
import { registry } from '../../registry.ts';
import { GenerationFailed, GenerationRefused, generate, generateGraph, withContextFile } from './generate.ts';

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

const runner = (outcome: (body: string) => Record<string, unknown>): CodeRunner => ({
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
    expect(ai.asked[0].prompt).toContain('Must expose run(inputs)');    // the block's own contract, first
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
