import { lazy } from 'react';
import type { WidgetUi } from '../../Ui';
import TableWidgetView from './TableWidgetView';
import { TableWidgetElement } from '@engine/elements/widgets/table/TableWidgetElement.ts';
import { fromEngine } from '@/authoring/generation';

/** Display-only, like plot_window: takes rows to show, emits nothing. */
export const tableWidgetUi: WidgetUi = {
  widgetKind: 'table',
  generation: {
    ...fromEngine(new TableWidgetElement().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the rows you want, e.g. one row per file with name, size and date.',
    bodyLabel: 'Optional transform — run(inputs) receives {"value"} and returns {"value"}',
    mono: true,
    bodyPlaceholder: 'Leave empty to show the incoming rows as-is.',
    bodyHeight: 90,
  },
  Panel: lazy(() => import('./TableWidgetPanel')),
  View: TableWidgetView,
};
