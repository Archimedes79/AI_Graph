import { describe, expect, it } from 'vitest';
import { imageMediaType } from '../../../execution/images.ts';
import { parseWidget } from '../../nodes/gui/GuiNodeRunner.ts';
import { ImageViewWidgetRunner } from './ImageViewWidgetRunner.ts';
import { quietRuntime } from '../../../../test/fakes.ts';

const element = new ImageViewWidgetRunner();

describe('what an image block says it draws', () => {
  it('names only picture formats a run can read', () => {
    // The block's dialog said SVG as well, and a run refused an .svg path as
    // "Not a recognised image file".
    const named = element.draws().match(/([A-Za-z, ]+) are recognised/)![1]
      .split(/, | and /).map((format) => format.trim().toLowerCase());
    expect(named.length).toBeGreaterThan(0);
    for (const format of named) expect(imageMediaType(`picture.${format}`), format).not.toBeNull();
  });
});

describe('what an image block shows', () => {
  const block = parseWidget({ id: 'img', kind: 'image_view' });
  const runtime = quietRuntime({ files: { read: async (path) => `bytes of ${path}` } });

  it('shows a path that arrives as the picture it names, read by the run', async () => {
    await expect(element.displayValue(block, 'cover.png', runtime)).resolves.toBe('data:image/png;base64,bytes of cover.png');
  });

  it('hands a URL or a data URL through as it arrived', async () => {
    for (const value of ['https://example.org/a.png', 'data:image/gif;base64,R0lG']) {
      await expect(element.displayValue(block, value, runtime)).resolves.toBe(value);
    }
  });

  it('shows a list as a list of pictures, and says which one it could not read', async () => {
    await expect(element.displayValue(block, ['a.jpg', 'notes.txt'], runtime))
      .resolves.toEqual(['data:image/jpeg;base64,bytes of a.jpg', '⚠ Not a recognised image file: notes.txt']);
  });
});
