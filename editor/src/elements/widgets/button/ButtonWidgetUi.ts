import { WidgetUi } from '../../WidgetUi';
import ButtonWidgetView from './ButtonWidgetView';

/** A button: pressing it starts the graph where it is wired. Nothing to set beyond its label. */
export class ButtonWidgetUi extends WidgetUi {
  readonly widgetKind = 'button';

  readonly View = ButtonWidgetView;

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Button';

  protected override defaultSpan() {
    return { w: 5, h: 2 };
  }
}
