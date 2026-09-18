import { TransformingDisplay } from '../TransformingDisplay.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { TRANSFORM_FIELDS } from '../TransformingDisplay.ts';

/** Rows to show, as a list of objects. */
export class TableWidget extends TransformingDisplay {
  readonly widgetKind = 'table' as const;

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
