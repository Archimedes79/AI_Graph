import type { GuiWidgetElementDefinition } from '@/elements/types';
import TableEditor from './Editor';
import TableWidget from '@/components/gui/widgets/TableWidget';
import { TableElement } from '../element.ts';
import { fromEngine } from '@/elements/shared/generation';

/** Display-only, like plot_window: takes rows to show, emits nothing. */
export const tableElement: GuiWidgetElementDefinition = {
  widgetKind: 'table',
  generation: {
    ...fromEngine(new TableElement().generation()),
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
