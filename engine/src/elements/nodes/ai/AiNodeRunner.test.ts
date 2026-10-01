import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiNodeRunner } from './AiNodeRunner.ts';
import { nodeFiles } from '../../../host/node.ts';
import type { AiRequest, Runtime } from '../../Runtime.ts';
import type { GraphNode } from '../../../graph.ts';

/**
 * What an AI node sends.
 *
 * Two things it is easy to get wrong and impossible to notice: a picture sent
 * as its filename (the model dutifully talks about the filename) and a list
 * sent as a serialised list (the model reads around brackets and quotes to
 * find the text).
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function aiNode(config: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'ai', node_type: 'ai', label: 'Ask', description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [],
    config: { prompt: 'be brief', ...config },
  };
}

/** A runtime that records the request instead of making it. */
function recording(): { runtime: Runtime; asked: AiRequest[] } {
  const asked: AiRequest[] = [];
  return {
    asked,
    runtime: {
      files: nodeFiles,
      code: { run: async (_body, inputs) => inputs },
      ai: { complete: async (request) => { asked.push(request); return 'answered'; } },
    },
  };
}

async function withImage(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-graph-ai-'));
  try {
    const path = join(dir, 'cat.png');
    await writeFile(path, PNG);
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('what an AI node sends', () => {
  const element = new AiNodeRunner();

  it('sends everything wired in, in port order, each under its port id where there are several', async () => {
    // Not a port called `prompt`: a node with two inputs from two upstream
    // nodes should send both, and naming one would drop the other in silence.
    const { runtime, asked } = recording();
    await element.execute(aiNode(), { first: 'one', second: 'two' }, runtime);
    expect(asked[0].prompt).toBe('first:\none\n\nsecond:\ntwo');
    expect(asked[0].system).toBe('be brief');
    await element.execute(aiNode(), { only: 'one' }, runtime);
    expect(asked[1].prompt).toBe('one');
  });

  it('sends its instructions as the message when nothing is wired in', async () => {
    // It used to send them as the system prompt beside an empty message, which
    // some providers refuse and the rest answer with a guess.
    const { runtime, asked } = recording();
    await element.execute(aiNode({ prompt: 'Write a haiku about autumn.' }), {}, runtime);
    expect(asked[0].prompt).toBe('Write a haiku about autumn.');
    expect(asked[0].system).toBe('');
  });

  it('runs on its description, in the standard instructions, while it has none of its own', async () => {
    const { runtime, asked } = recording();
    const node = { ...aiNode({ prompt: '' }), label: 'Shout', description: 'Say it in capitals.' };
    await element.execute(node, { text: 'hello' }, runtime);
    expect(asked[0].system).toBe('# Shout (ID ai, ai node)\n\nSay it in capitals.\n\nDo this with the input below. Answer in plain text.');
    expect(asked[0].prompt).toBe('hello');
  });

  it('fills in its description and its output definition where its own instructions name them', async () => {
    const { runtime, asked } = recording();
    const node = { ...aiNode({ prompt: 'Task:\n{Node Description}\nAnswer as:\n{Output Definition}\nNot {Context}.', output_definition: 'module.exports = { "n": 1 };' }), description: 'Count.' };
    await element.execute(node, { text: 'a b' }, runtime).catch(() => undefined);
    expect(asked[0].system).toBe('Task:\n# Ask (ID ai, ai node)\n\nCount.\nAnswer as:\nmodule.exports = { "n": 1 };\nNot {Context}.');
  });

  it('sends a list as paragraphs, not as a serialised list', async () => {
    const { runtime, asked } = recording();
    await element.execute(aiNode(), { summaries: ['first', 'second'] }, runtime);
    expect(asked[0].prompt).toBe('first\n\nsecond');
    expect(asked[0].prompt).not.toContain('[');
  });

  it('sends an image as an image, and keeps its path out of the prompt', async () => {
    await withImage(async (path) => {
      const { runtime, asked } = recording();
      await element.execute(aiNode({ send_images: true }), { picture: path }, runtime);
      expect(asked[0].files?.[0]?.startsWith('data:image/png;base64,')).toBe(true);
      expect(asked[0].prompt).not.toContain(path);
    });
  });

  it('sends every image of a list, not the first', async () => {
    // A folder picker wired straight in is the case this exists for.
    await withImage(async (path) => {
      const { runtime, asked } = recording();
      await element.execute(aiNode({ send_images: true }), { pictures: [path, path] }, runtime);
      expect(asked[0].files).toHaveLength(2);
    });
  });

  it('keeps the words of a list that holds images and words', async () => {
    // A photo and its caption, wired in as one list: the caption is not an image, and not nothing.
    await withImage(async (path) => {
      const { runtime, asked } = recording();
      await element.execute(aiNode({ send_images: true }), { photos: [path, 'caption: a red barn'] }, runtime);
      expect(asked[0].files).toHaveLength(1);
      expect(asked[0].prompt).toBe('caption: a red barn');
    });
  });

  it('sends a temperature only when the node sets one', async () => {
    const { runtime, asked } = recording();
    await element.execute(aiNode(), { question: 'x' }, runtime);
    await element.execute(aiNode({ temperature: 0.3 }), { question: 'x' }, runtime);
    expect(asked[0]).not.toHaveProperty('temperature');
    expect(asked[1].temperature).toBe(0.3);
  });

  it('leaves an image path as prompt text when the toggle is off', async () => {
    await withImage(async (path) => {
      const { runtime, asked } = recording();
      await element.execute(aiNode(), { picture: path }, runtime);
      expect(asked[0].prompt).toBe(path);
      expect(asked[0].files).toBeUndefined();
    });
  });

  it('sends a PDF a file port read as the file it is, toggle or not', async () => {
    // A statement in a layout nobody agreed on: the model reads it as it came.
    const { runtime, asked } = recording();
    await element.execute(aiNode(), { statement: 'data:application/pdf;base64,JVBE', note: 'the total' }, runtime);
    expect(asked[0].files).toEqual(['data:application/pdf;base64,JVBE']);
    expect(asked[0].prompt).toBe('the total');
  });

  it('treats an unreadable image as text rather than failing the node', async () => {
    // Sending the picture was optional; failing the whole node over one that
    // has gone missing is not what the person wiring it asked for.
    const { runtime, asked } = recording();
    await element.execute(aiNode({ send_images: true }), { picture: 'gone.png' }, runtime);
    expect(asked[0].prompt).toBe('gone.png');
    expect(asked[0].files).toBeUndefined();
  });
});

describe('a call that fails', () => {
  const failing: Runtime = {
    files: nodeFiles,
    code: { run: async (_body, inputs) => inputs },
    ai: { complete: async () => { throw new Error('no content'); } },
  };

  /**
   * It throws either way. Whether that ends the run or becomes an `error`
   * port is `catch_errors`, read by the executor for every element alike --
   * see `executor.test.ts`, which is where that behaviour is pinned down.
   */
  it('throws, and leaves what to do about it to the executor', async () => {
    const element = new AiNodeRunner();
    await expect(element.execute(aiNode(), {}, failing)).rejects.toThrow('no content');
    await expect(element.execute(aiNode({ catch_errors: true }), {}, failing)).rejects.toThrow('no content');
  });
});

/**
 * A node that maps whatever arrives onto a fixed format: with an output
 * definition that names several outputs, or a value that is not text, the
 * answer is the JSON it defines, and each key goes out on its own port -- not
 * a text of it. One output that holds text is the answer itself.
 */
describe('an answer mapped onto an output definition', () => {
  const element = new AiNodeRunner();
  const answering = (reply: string): Runtime => ({
    files: nodeFiles,
    code: { run: async (_body, inputs) => inputs },
    ai: { complete: async () => reply },
  });
  const defined = (): GraphNode => aiNode({ output_definition: 'module.exports = { "rows": [1], "count": 1 };' });

  it('is handed on key by key, a ```json fence around it taken off', async () => {
    expect(await element.execute(defined(), {}, answering('{"rows": [1, 2], "count": 2}'))).toEqual({ rows: [1, 2], count: 2 });
    expect(await element.execute(defined(), {}, answering('```json\n{"rows": [], "count": 0}\n```'))).toEqual({ rows: [], count: 0 });
  });

  it('is read the way output.js is read, where the model answered in its format', async () => {
    // A small model shown the definition file answers with a file like it.
    const echoed = '```js\n/** @typedef {Object} Output */\nmodule.exports = {\n  "rows": [3],\n  "count": 1\n};\n```';
    expect(await element.execute(defined(), {}, answering(echoed))).toEqual({ rows: [3], count: 1 });
  });

  it('is found where the answer holds it, with a sentence around it', async () => {
    // A model asked for the JSON object and nothing else still says so first.
    expect(await element.execute(defined(), {}, answering('Here is the result:\n```json\n{"rows": [4], "count": 1}\n```\nI kept it short.')))
      .toEqual({ rows: [4], count: 1 });
    expect(await element.execute(defined(), {}, answering('Sure! Here are the rows: {"rows": [], "count": 0} -- hope it helps.')))
      .toEqual({ rows: [], count: 0 });
  });

  it('fails the node when it holds no JSON object, saying how it began', async () => {
    await expect(element.execute(defined(), {}, answering('Sure! There are no rows.')))
      .rejects.toThrow(/not the JSON object this node's output\.js asks for\. It began: "Sure! There are no rows/);
    await expect(element.execute(defined(), {}, answering('[1, 2]'))).rejects.toThrow(/not the JSON object/);
  });

  it('is the answer as it came, on "output", without one', async () => {
    expect(await element.execute(aiNode(), {}, answering('{"rows": []}'))).toEqual({ output: '{"rows": []}' });
  });

  it('is the answer as it came, in plain text, where the definition names one output that holds text -- on that output', async () => {
    const summary = { ...aiNode({ prompt: '', output_definition: '/** @typedef {Object} Output */\nmodule.exports = { "summary": "Two sentences." };' }), description: 'Sum it up.' };
    const asked: AiRequest[] = [];
    const runtime: Runtime = { ...answering(''), ai: { complete: async (request) => { asked.push(request); return 'It rains. Then it stops.'; } } };
    expect(await element.execute(summary, { text: 'a' }, runtime)).toEqual({ summary: 'It rains. Then it stops.' });
    expect(asked[0].system).toMatch(/Answer in plain text: the text itself, as this output definition describes it -- not JSON/);
    // Nothing is parsed: an answer that looks like JSON is the text it is.
    expect(await element.execute(summary, {}, answering('{"summary": "x"}'))).toEqual({ summary: '{"summary": "x"}' });
  });

  it('is JSON where the definition names one output that is not text', async () => {
    const counted = aiNode({ output_definition: 'module.exports = { "count": 1 };' });
    expect(await element.execute(counted, {}, answering('```json\n{"count": 3}\n```'))).toEqual({ count: 3 });
  });
});
