import { lazy } from 'react';
import type { WidgetUi } from '../../ElementUi';
import SelectWidgetView from './SelectWidgetView';

export const selectWidgetUi: WidgetUi = {
  widgetKind: 'select',
  Panel: lazy(() => import('./SelectWidgetPanel')),
  View: SelectWidgetView,
};
