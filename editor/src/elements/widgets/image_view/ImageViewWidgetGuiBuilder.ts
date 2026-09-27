import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { ImageViewWidgetRunner } from '@engine/elements/widgets/image_view/ImageViewWidgetRunner.ts';
import { TransformingDisplayGuiBuilder } from '../TransformingDisplayGuiBuilder';

export class ImageViewWidgetGuiBuilder extends TransformingDisplayGuiBuilder {
  readonly widgetKind = 'image_view';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Image';

  readonly shows = 'An image file path or URL, or a list of them -- from a folder picker, say: the block reads each file and shows the picture. PNG, JPEG, GIF, WebP, BMP and SVG are recognised. Its code hands the path on as {"value": path}.';

  /** What arrives is a path this block reads itself. */
  override readonly takesPaths = true;

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(new ImageViewWidgetRunner().generation()),
    promptLabel: 'Which picture to show',
    promptPlaceholder: "e.g. the 'cover' field of each record",
    bodyLabel: 'Code — run(inputs) receives {"value"} and returns {"value": path}',
    bodyHeight: 90,
  };
}
