import { lazy } from 'react';
import { WidgetUi } from '../../WidgetUi';
import SliderWidgetView from './SliderWidgetView';

export class SliderWidgetUi extends WidgetUi {
  readonly widgetKind = 'slider';
  readonly label = 'Slider';
  readonly View = SliderWidgetView;
  override readonly Panel = lazy(() => import('./SliderWidgetPanel'));

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
