import type { GuiWidgetElementDefinition } from '@/elements/types';
import TextEditor from './Editor';
import TextWidget from '@/components/gui/widgets/TextWidget';

/** Prose on the page, rendered as markdown. No ports — see `StaticWidget`. */
export const textElement: GuiWidgetElementDefinition = {
  widgetKind: 'text',
  ConfigEditor: TextEditor,
  RuntimeWidget: TextWidget,
};
