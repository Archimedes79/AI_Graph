import type { GuiWidgetElementDefinition } from '@/elements/types';
import SliderWidget from '@/components/gui/widgets/SliderWidget';
import SliderEditor from './Editor';

export const sliderElement: GuiWidgetElementDefinition = {
  widgetKind: 'slider',
  ConfigEditor: SliderEditor,
  RuntimeWidget: SliderWidget,
};
