import type { GuiWidgetElementDefinition } from '../../../types';
import DividerEditor from './DividerEditor';
import DividerWidget from '../../../../components/gui/widgets/DividerWidget';

/** A rule between sections. No ports, no content. */
export const dividerElement: GuiWidgetElementDefinition = {
  widgetKind: 'divider',
  ports: () => ({ inputs: [], outputs: [] }),
  ConfigEditor: DividerEditor,
  RuntimeWidget: DividerWidget,
};
