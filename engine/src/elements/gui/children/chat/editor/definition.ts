import type { GuiWidgetElementDefinition } from '@/elements/types';
import ChatWidget from '@/components/gui/widgets/ChatWidget';

export const chatElement: GuiWidgetElementDefinition = {
  widgetKind: 'chat',
  // Nothing to configure: what it is wired to is the whole of what it does.
  // Its value is the conversation, which the block clears turn by turn itself
  // (see the engine's `ChatElement.settle`), so there is no `clearValueAfterRun`.
  RuntimeWidget: ChatWidget,
  ownsValue: true,
};
