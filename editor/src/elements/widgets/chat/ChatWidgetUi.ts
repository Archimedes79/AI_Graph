import type { WidgetUi } from '../../Ui';
import ChatWidgetView from './ChatWidgetView';

export const chatWidgetUi: WidgetUi = {
  widgetKind: 'chat',
  // Nothing to configure: what it is wired to is the whole of what it does.
  // Its value is the conversation, which the block clears turn by turn itself
  // (see the engine's `ChatWidgetElement.settle`), so there is no `clearValueAfterRun`.
  View: ChatWidgetView,
  ownsValue: true,
};
