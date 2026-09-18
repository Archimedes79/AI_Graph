import type { WidgetUi } from '../../Ui';
import DividerWidgetView from './DividerWidgetView';

/** A rule between sections. No ports, no content. */
export const dividerWidgetUi: WidgetUi = {
  widgetKind: 'divider',
  View: DividerWidgetView,
};
