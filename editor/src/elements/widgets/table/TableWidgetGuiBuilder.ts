import { TableWidgetRunner } from '@engine/elements/widgets/table/TableWidgetRunner.ts';
import { DisplayWidgetGuiBuilder } from '../DisplayWidgetGuiBuilder';
import { TABLE_TEXT } from './TableWidgetView';

export class TableWidgetGuiBuilder extends DisplayWidgetGuiBuilder {
  readonly widgetKind = 'table';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Table';

  paletteEntries() {
    return [{ label: this.label, icon: '▦', also: 'rows grid data' }];
  }

  readonly runner = new TableWidgetRunner();

  /** Its rows, at the size the table draws them. */
  override textShown(): string {
    return `${TABLE_TEXT} px rows`;
  }
}
