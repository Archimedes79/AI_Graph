import type { WidgetUi } from '../../ElementUi';
import DividerWidgetView from './DividerWidgetView';

/** A rule between sections. No ports, no content. */
export const dividerWidgetUi: WidgetUi = {
  widgetKind: 'divider',
  View: DividerWidgetView,
};
