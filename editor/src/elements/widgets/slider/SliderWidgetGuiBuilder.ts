import { lazy } from 'react';
import { WidgetGuiBuilder } from '../../WidgetGuiBuilder';

export class SliderWidgetGuiBuilder extends WidgetGuiBuilder {
  readonly widgetKind = 'slider';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Slider';

  override readonly Panel = lazy(() => import('./SliderWidgetPanel'));

  override readonly runOnChangeHint =
    'Letting go of the handle (or an arrow key) runs the nodes this slider is wired to — not every value it passes on the way.';

  protected override defaultSpan() {
    return { w: 8, h: 2 };
  }

  /** A control you operate looks like a field, or nobody touches it. */
  protected override defaultTone() {
    return 'sunken' as const;
  }

  protected override initialSettings() {
    return { min: 0, max: 100, step: 1 };
  }
}
