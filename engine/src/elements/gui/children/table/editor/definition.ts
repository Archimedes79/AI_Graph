import type { GuiWidgetElementDefinition } from '@/elements/types';
import TableEditor from './Editor';
import TableWidget from '@/components/gui/widgets/TableWidget';

/** Display-only, like plot_window: takes rows to show, emits nothing. */
export const tableElement: GuiWidgetElementDefinition = {
  widgetKind: 'table',
  generation: {
    promptField: 'code_prompt',
    targetField: 'code',
    guard: 'Please describe how to turn the incoming data into rows first.',
    success: '✅ Transform generated!',
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the rows you want, e.g. one row per file with name, size and date.',
    bodyLabel: 'Optional transform — run(inputs) receives {"value"} and returns {"value"}',
    mono: true,
    bodyPlaceholder: 'Leave empty to show the incoming rows as-is.',
    bodyHeight: 90,
  },
  ConfigEditor: TableEditor,
  RuntimeWidget: TableWidget,
};
