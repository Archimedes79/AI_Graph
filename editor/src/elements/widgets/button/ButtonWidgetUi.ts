import type { WidgetUi } from '../../Ui';
import ButtonWidgetView from './ButtonWidgetView';

export const buttonWidgetUi: WidgetUi = {
  widgetKind: 'button',
  // Nothing to configure beyond the label every block already has.
  View: ButtonWidgetView,
};
