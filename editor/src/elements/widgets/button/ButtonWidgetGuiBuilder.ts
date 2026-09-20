import { WidgetGuiBuilder } from '../../WidgetGuiBuilder';

/** A button: pressing it starts the graph where it is wired. Nothing to set beyond its label. */
export class ButtonWidgetGuiBuilder extends WidgetGuiBuilder {
  readonly widgetKind = 'button';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Button';

  protected override defaultSpan() {
    return { w: 5, h: 2 };
  }
}
