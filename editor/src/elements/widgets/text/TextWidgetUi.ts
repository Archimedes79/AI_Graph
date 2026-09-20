import { lazy } from 'react';
import { StaticWidgetUi } from '../StaticWidgetUi';
import TextWidgetView from './TextWidgetView';

/** Prose on the page, rendered as markdown: a heading, a paragraph, a caption. */
export class TextWidgetUi extends StaticWidgetUi {
  readonly widgetKind = 'text';

  readonly View = TextWidgetView;

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Text';

  override readonly Panel = lazy(() => import('./TextWidgetPanel'));

  override readonly defaultMode = 'body';

  /** Typed where it stands, on the page being built. */
  override readonly inlineText = true;

  /**
   * One row for a heading or a caption -- it starts where every other widget
   * starts, with no air above it -- and three for a paragraph.
   */
  protected override defaultSpan(mode: string) {
    return mode === 'heading' || mode === 'caption' ? { w: 16, h: 1 } : { w: 16, h: 3 };
  }
}
