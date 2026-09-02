import type { GuiWidgetElementDefinition } from '@/elements/types';
import DividerWidget from '@/components/gui/widgets/DividerWidget';

/** A rule between sections. No ports, no content. */
export const dividerElement: GuiWidgetElementDefinition = {
  widgetKind: 'divider',
  RuntimeWidget: DividerWidget,
};
