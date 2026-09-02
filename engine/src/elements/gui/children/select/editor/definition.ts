import type { GuiWidgetElementDefinition } from '@/elements/types';
import SelectWidget from '@/components/gui/widgets/SelectWidget';
import SelectEditor from './Editor';

export const selectElement: GuiWidgetElementDefinition = {
  widgetKind: 'select',
  ConfigEditor: SelectEditor,
  RuntimeWidget: SelectWidget,
};
