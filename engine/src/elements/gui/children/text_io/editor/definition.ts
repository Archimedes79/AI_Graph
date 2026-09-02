import type { GuiWidget, Port } from '@/types/graph';
import type { GuiWidgetElementDefinition } from '@/elements/types';
import TextIoWidget from '@/components/gui/widgets/TextIoWidget';
import TextIoEditor from './Editor';
import { effectiveTextIoMode } from './mode';

export const textIoElement: GuiWidgetElementDefinition = {
  widgetKind: 'text_io',
  ConfigEditor: TextIoEditor,
  RuntimeWidget: TextIoWidget,
  // "input"/"both": the widget's value is the user's typed message, sent once
  // the graph runs -- clear it afterward so the next run doesn't resend the
  // same message, and the box is ready for the next chat turn.
  clearValueAfterRun: (widget) => effectiveTextIoMode(widget) !== 'output',
};
