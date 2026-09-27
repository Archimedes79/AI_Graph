import { TransformingDisplayRunner } from '../TransformingDisplayRunner.ts';
import type { Widget } from '../../WidgetRunner.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { TRANSFORM_FIELDS } from '../TransformingDisplayRunner.ts';

/** Rows to show, as a list of objects. */
export class TableWidgetRunner extends TransformingDisplayRunner {
  readonly widgetKind = 'table' as const;

  // ── Build time ────────────────────────────────────────────────────────────

  /**
   * Rows -- unless the table has a transform of its own, which takes whatever
   * it was written to read and makes the rows itself. A block handed over
   * without its settings (`config`) counts as one without a transform.
   */
  override receives(widget: Widget): string | undefined {
    if (String(widget.config?.code ?? '').trim()) return undefined;
    return 'rows: a list of objects with the same keys -- each key becomes a column header, in the '
      + 'order the first row has them -- or a list of lists whose first row is the header.';
  }

  override generation(): Generation {
    return {
      kind: 'code', fields: TRANSFORM_FIELDS,
      contract:
        'Must expose run(inputs) -> object, receiving {"value": <raw incoming data>} '
        + 'and returning {"value": <table-ready rows>}. Table-ready data is a JSON-serialisable '
        + 'list of objects with the same keys (the keys become the column headers), or a list of '
        + 'lists whose first row is the header. The app renders the table itself — do NOT format '
        + 'it as text and do NOT import third-party libraries: the code runs in a sandbox with '
        + 'only the standard library available.',
      inputs: ['value'], outputs: ['value'],
      check: (outputs) => {
        const rows = outputs.value;
        if (!Array.isArray(rows)) return [`"value" is ${rows === null ? 'null' : typeof rows}; a table needs a list of rows.`];
        if (!rows.length) return [];
        const objects = rows.every((row) => row && typeof row === 'object' && !Array.isArray(row));
        const lists = rows.every((row) => Array.isArray(row));
        return objects || lists ? [] : ['The rows are a mix of shapes. Return either a list of objects with the same keys, or a list of lists whose first row is the header.'];
      },
      guard: 'Please describe how to turn the incoming data into rows first.',
      success: '✅ Transform generated!',
    };
  }
}
