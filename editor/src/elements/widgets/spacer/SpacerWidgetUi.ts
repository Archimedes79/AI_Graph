import type { WidgetUi } from '../../Ui';
import SpacerWidgetView from './SpacerWidgetView';

/** Nothing, on purpose: the block that says "this section ends here". */
export const spacerWidgetUi: WidgetUi = {
  widgetKind: 'spacer',
  View: SpacerWidgetView,
};
