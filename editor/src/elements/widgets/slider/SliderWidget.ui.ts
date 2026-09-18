import { lazy } from 'react';
import type { WidgetUi } from '../../ElementUi';
import SliderWidgetView from './SliderWidgetView';

export const sliderWidgetUi: WidgetUi = {
  widgetKind: 'slider',
  Panel: lazy(() => import('./SliderWidgetPanel')),
  View: SliderWidgetView,
};
