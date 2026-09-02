import type { GuiWidgetElementDefinition } from '@/elements/types';
import SpacerWidget from '@/components/gui/widgets/SpacerWidget';

/** Nothing, on purpose: the block that says "this section ends here". */
export const spacerElement: GuiWidgetElementDefinition = {
  widgetKind: 'spacer',
  RuntimeWidget: SpacerWidget,
};
