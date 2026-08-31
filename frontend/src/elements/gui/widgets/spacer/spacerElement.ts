import type { GuiWidgetElementDefinition } from '../../../types';
import SpacerEditor from './SpacerEditor';
import SpacerWidget from '../../../../components/gui/widgets/SpacerWidget';

/** Nothing, on purpose: the block that says "this section ends here". */
export const spacerElement: GuiWidgetElementDefinition = {
  widgetKind: 'spacer',
  ports: () => ({ inputs: [], outputs: [] }),
  ConfigEditor: SpacerEditor,
  RuntimeWidget: SpacerWidget,
};
