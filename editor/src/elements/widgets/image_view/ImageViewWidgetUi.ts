import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { ImageViewWidgetElement } from '@engine/elements/widgets/image_view/ImageViewWidgetElement.ts';
import { TransformingDisplayUi } from '../TransformingDisplayUi';

export class ImageViewWidgetUi extends TransformingDisplayUi {
  readonly widgetKind = 'image_view';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Image';

  readonly transformTitle = 'Path transform (optional)';

  readonly transformHelp = 'The code must return {"value": <path>} — one image path, or a list of them.';

  override readonly intro = 'Wire a file path (or a list of them, from a directory picker) into this widget and it displays the picture. PNG, JPEG, GIF, WebP, BMP and SVG are recognised. A transform is only needed when the incoming value is not already a path — e.g. picking one field out of a record.';

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(new ImageViewWidgetElement().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: "Describe how to get an image path out of the incoming value, e.g. take the 'cover' field of each record.",
    bodyLabel: 'Optional transform — run(inputs) receives {"value"} and returns {"value"}',
    mono: true,
    bodyPlaceholder: 'Leave empty to display the incoming path as-is.',
    bodyHeight: 90,
  };
}
