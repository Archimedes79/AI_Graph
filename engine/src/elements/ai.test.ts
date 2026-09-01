import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiElement } from './ai.ts';
import { nodeFiles } from '../host/node.ts';
import type { AiRequest, Runtime } from '../element.ts';
import type { GraphNode } from '../graph.ts';

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
    config: { system_prompt: 'be brief', ...config },
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
  const element = new AiElement();

  it('joins everything wired in, in port order', async () => {
    // Not a port called `prompt`: a node with two inputs from two upstream
    // nodes should send both, and naming one would drop the other in silence.
    const { runtime, asked } = recording();
    await element.execute(aiNode(), { first: 'one', second: 'two' }, runtime);
    expect(asked[0].prompt).toBe('one\n\ntwo');
    expect(asked[0].system).toBe('be brief');
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
      expect(asked[0].images?.[0]?.startsWith('data:image/png;base64,')).toBe(true);
      expect(asked[0].prompt).not.toContain(path);
    });
  });

  it('sends every image of a list, not the first', async () => {
    // A folder picker wired straight in is the case this exists for.
    await withImage(async (path) => {
      const { runtime, asked } = recording();
      await element.execute(aiNode({ send_images: true }), { pictures: [path, path] }, runtime);
      expect(asked[0].images).toHaveLength(2);
    });
  });

  it('leaves an image path as prompt text when the toggle is off', async () => {
    await withImage(async (path) => {
      const { runtime, asked } = recording();
      await element.execute(aiNode(), { picture: path }, runtime);
      expect(asked[0].prompt).toBe(path);
      expect(asked[0].images).toBeUndefined();
    });
  });

  it('treats an unreadable image as text rather than failing the node', async () => {
    // Sending the picture was optional; failing the whole node over one that
    // has gone missing is not what the person wiring it asked for.
    const { runtime, asked } = recording();
    await element.execute(aiNode({ send_images: true }), { picture: 'gone.png' }, runtime);
    expect(asked[0].prompt).toBe('gone.png');
    expect(asked[0].images).toBeUndefined();
  });
});
