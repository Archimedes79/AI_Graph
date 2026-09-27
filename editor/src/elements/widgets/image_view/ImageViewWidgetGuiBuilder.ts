import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { ImageViewWidgetRunner } from '@engine/elements/widgets/image_view/ImageViewWidgetRunner.ts';
import { TransformingDisplayGuiBuilder } from '../TransformingDisplayGuiBuilder';

export class ImageViewWidgetGuiBuilder extends TransformingDisplayGuiBuilder {
  readonly widgetKind = 'image_view';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Image';

  paletteEntries() {
    return [{ label: this.label, icon: '🖼️', also: 'picture photo' }];
  }

  readonly runner = new ImageViewWidgetRunner();

  readonly shows = this.drawsAnd('Its code hands the path on as {"value": path}.');

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(this.runner.generation()),
    promptLabel: 'Which picture to show',
    promptPlaceholder: "e.g. the 'cover' field of each record",
    bodyLabel: 'Code — run(inputs) receives {"value"} and returns {"value": path}',
    bodyHeight: 90,
  };
}
