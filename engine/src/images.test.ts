import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageDataUrl, imageMediaType, isInlineUrl, splitDataUrl, MAX_INLINE_IMAGE_BYTES } from './images.ts';
import { nodeFiles } from './host/node.ts';
import { registry } from './registry.ts';
import { parseWidget } from './elements/gui.ts';
import type { Runtime } from './element.ts';

/**
 * Pictures, on the way to a browser or to a model.
 *
 * Both need the same thing for the same reason — the engine's filesystem is
 * neither of theirs — and both refuse the same two things by name: a file that
 * is not an image, and one too large to inline. Refusing late means a broken
 * picture in one case and a bill in the other.
 */

// A one-pixel PNG, so a real file with a real header exists to read.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const runtime = { files: nodeFiles } as Runtime;

async function withFiles(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-graph-images-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('imageMediaType', () => {
  it('knows the formats a browser and a provider both take', () => {
    expect(imageMediaType('a.png')).toBe('image/png');
    expect(imageMediaType('A.JPG')).toBe('image/jpeg');
    expect(imageMediaType('a.webp')).toBe('image/webp');
    expect(imageMediaType('notes.txt')).toBeNull();
    expect(imageMediaType('no-suffix')).toBeNull();
  });
});

describe('imageDataUrl', () => {
  it('inlines a real image', async () => {
    await withFiles(async (dir) => {
      const path = join(dir, 'dot.png');
      await writeFile(path, PNG);
      const url = await imageDataUrl(path, runtime.files);
      expect(url.startsWith('data:image/png;base64,')).toBe(true);
      expect(splitDataUrl(url)[0]).toBe('image/png');
    });
  });

  it('refuses a file that is not an image, by name', async () => {
    await withFiles(async (dir) => {
      const path = join(dir, 'notes.txt');
      await writeFile(path, 'not a picture');
      await expect(imageDataUrl(path, runtime.files)).rejects.toThrow(/Not a recognised image/);
    });
  });

  it('refuses one too large to inline, and says how large', async () => {
    await withFiles(async (dir) => {
      const path = join(dir, 'huge.png');
      await writeFile(path, Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1024, 0));
      await expect(imageDataUrl(path, runtime.files)).rejects.toThrow(/MB; the limit is/);
    });
  });
});

describe('the image block', () => {
  const element = registry.widget('image_view')!;
  const widget = parseWidget({ id: 'w', kind: 'image_view', label: 'Picture' });

  it('shows a path as an inlined picture', async () => {
    await withFiles(async (dir) => {
      const path = join(dir, 'dot.png');
      await writeFile(path, PNG);
      const shown = await element.displayValue(widget, path, runtime);
      expect(String(shown).startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  it('passes a URL through untouched', async () => {
    expect(isInlineUrl('https://example.com/a.png')).toBe(true);
    expect(await element.displayValue(widget, 'https://example.com/a.png', runtime))
      .toBe('https://example.com/a.png');
  });

  it('turns a list into a contact sheet', async () => {
    await withFiles(async (dir) => {
      const one = join(dir, 'a.png');
      const two = join(dir, 'b.png');
      await writeFile(one, PNG);
      await writeFile(two, PNG);
      const shown = await element.displayValue(widget, [one, two], runtime) as string[];
      expect(shown).toHaveLength(2);
      expect(shown.every((url) => url.startsWith('data:image/png'))).toBe(true);
    });
  });

  it('shows the reason instead of raising it', async () => {
    // Nothing downstream depends on a picture, and failing would take every
    // sibling block's output down with it.
    const shown = await element.displayValue(widget, 'missing.png', runtime);
    expect(String(shown).startsWith('⚠')).toBe(true);
  });
});
