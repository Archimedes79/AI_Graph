import type { GuiWidgetElementDefinition } from '@/elements/types';
import ButtonWidget from '@/components/gui/widgets/ButtonWidget';

export const buttonElement: GuiWidgetElementDefinition = {
  widgetKind: 'button',
  // Nothing to configure beyond the label every block already has.
  RuntimeWidget: ButtonWidget,
};
