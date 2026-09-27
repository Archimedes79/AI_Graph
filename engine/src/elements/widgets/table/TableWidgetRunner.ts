import { DisplayWidgetRunner } from '../DisplayWidgetRunner.ts';

/** Rows to show, as a list of objects. */
export class TableWidgetRunner extends DisplayWidgetRunner {
  readonly widgetKind = 'table' as const;

  // ── Build time ────────────────────────────────────────────────────────────

  /** Rows, whose keys become the columns. */
  override draws(): string {
    return 'rows: a list of objects with the same keys -- each key becomes a column header, in the '
      + 'order the first row has them -- or a list of lists whose first row is the header.';
  }
}
