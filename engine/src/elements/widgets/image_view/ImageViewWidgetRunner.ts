import { type Runtime } from '../../Runtime.ts';
import { type Widget } from '../../WidgetRunner.ts';
import { imageDataUrl, isInlineUrl } from '../../../execution/images.ts';
import { TransformingDisplayRunner } from '../TransformingDisplayRunner.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { TRANSFORM_FIELDS } from '../TransformingDisplayRunner.ts';

/** An image, by path. */
export class ImageViewWidgetRunner extends TransformingDisplayRunner {
  readonly widgetKind = 'image_view' as const;

  /**
   * Whatever arrived, turned into something a browser can render.
   *
   * A path is read and inlined; a value that is already a data or http URL
   * passes through; a list becomes a list of the same, so a folder picker
   * wired straight in shows a contact sheet. The one thing this block does
   * that a chart does not.
   *
   * A failure is shown, not raised — the same rule as a failing transform.
   * Nothing downstream depends on a picture, and taking the whole node down
   * would take every sibling block's output with it.
   *
   * So a failure that arrives here -- a transform's, already a "⚠" message --
   * is shown as it is. Loaded as a path, it came out as "Not a recognised
   * image file: <the folder>\⚠ img: transform failed: …".
   */
  override async displayValue(widget: Widget, value: unknown, runtime: Runtime): Promise<unknown> {
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this.displayValue(widget, item, runtime)));
    }
    if (typeof value !== 'string' || !value.trim()) return value;
    if (isInlineUrl(value) || value.startsWith('⚠ ')) return value;
    try {
      return await imageDataUrl(value, runtime.files);
    } catch (error) {
      return `⚠ ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  // ── Build time ────────────────────────────────────────────────────────────

  /**
   * A path, which the block reads itself. The formats are the ones
   * `imageMediaType` knows; the editor said SVG as well, which a run refuses.
   */
  override draws(): string {
    return 'an image file path or URL, or a list of them -- not the picture\'s bytes: the block reads '
      + 'each file and shows the picture. PNG, JPEG, GIF, WebP and BMP are recognised.';
  }

  /** What `displayValue` above reads. */
  override readonly readsPaths = true;

  /** The same snippet contract as a chart, with a different destination: a path. */
  override generation(): Generation {
    return {
      kind: 'code', fields: TRANSFORM_FIELDS,
      contract:
        'Must expose run(inputs) -> object, receiving {"value": <raw incoming value>} '
        + 'and returning {"value": <an image file path, or a list of them>}. The app loads '
        + 'and displays the picture itself — do NOT read, decode or draw the image, and do '
        + 'NOT import third-party libraries: the code runs in a sandbox with only the '
        + 'standard library available.',
      inputs: ['value'], outputs: ['value'],
      guard: 'Please describe how to get an image path out of the incoming value first.',
      success: '✅ Transform generated!',
    };
  }
}
