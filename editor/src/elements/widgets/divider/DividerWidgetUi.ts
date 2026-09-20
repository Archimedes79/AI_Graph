import { StaticWidgetUi } from '../StaticWidgetUi';
import DividerWidgetView from './DividerWidgetView';

/** A rule between sections. */
export class DividerWidgetUi extends StaticWidgetUi {
  readonly widgetKind = 'divider';

  readonly View = DividerWidgetView;

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Divider';

  override readonly defaultMode = 'horizontal';

  /**
   * A vertical one stands between two things side by side, so it is narrow
   * and tall; a horizontal one ends a section, so it is the reverse.
   */
  protected override defaultSpan(mode: string) {
    return mode === 'vertical' ? { w: 1, h: 4 } : { w: 16, h: 1 };
  }
}
