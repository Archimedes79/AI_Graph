import { TableWidgetRunner } from '@engine/elements/widgets/table/TableWidgetRunner.ts';
import { DisplayWidgetGuiBuilder } from '../DisplayWidgetGuiBuilder';

export class TableWidgetGuiBuilder extends DisplayWidgetGuiBuilder {
  readonly widgetKind = 'table';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Table';

  paletteEntries() {
    return [{ label: this.label, icon: '▦', also: 'rows grid data' }];
  }

  readonly runner = new TableWidgetRunner();
}
