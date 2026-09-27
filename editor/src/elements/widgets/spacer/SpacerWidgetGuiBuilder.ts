import { StaticWidgetGuiBuilder } from '../StaticWidgetGuiBuilder';

/** Nothing, on purpose: the widget that says "this section ends here". */
export class SpacerWidgetGuiBuilder extends StaticWidgetGuiBuilder {
  readonly widgetKind = 'spacer';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Gap';

  paletteEntries() {
    return [
      { mode: 'horizontal', label: this.label, icon: '␣', also: 'space spacer' },
      { mode: 'vertical', label: 'Vertical gap', icon: '┆' },
    ];
  }

  override readonly defaultMode = 'horizontal';

  /**
   * A vertical one stands between two things side by side, so it is narrow
   * and tall; a horizontal one ends a section, so it is the reverse.
   */
  protected override defaultSpan(mode: string) {
    return mode === 'vertical' ? { w: 1, h: 4 } : { w: 16, h: 1 };
  }
}
