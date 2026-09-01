import type { GuiWidgetElementDefinition } from '../../../types';
import TextEditor from './TextEditor';
import TextWidget from '../../../../components/gui/widgets/TextWidget';

/** Prose on the page, rendered as markdown. No ports — see `StaticWidget`. */
export const textElement: GuiWidgetElementDefinition = {
  widgetKind: 'text',
  ConfigEditor: TextEditor,
  RuntimeWidget: TextWidget,
};
