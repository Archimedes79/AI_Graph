import { ImageViewWidgetRunner } from '@engine/elements/widgets/image_view/ImageViewWidgetRunner.ts';
import { DisplayWidgetGuiBuilder } from '../DisplayWidgetGuiBuilder';

export class ImageViewWidgetGuiBuilder extends DisplayWidgetGuiBuilder {
  readonly widgetKind = 'image_view';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Image';

  paletteEntries() {
    return [{ label: this.label, icon: '🖼️', also: 'picture photo' }];
  }

  readonly runner = new ImageViewWidgetRunner();

  /** A picture has no text of its own: its size is what there is to say. */
  override textShown(): undefined {
    return undefined;
  }
}
