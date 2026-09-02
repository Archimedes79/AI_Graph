import { TransformingDisplay } from '../display.ts';
import type { Generation } from '../../../../generation.ts';
import { TRANSFORM_FIELDS } from '../display.ts';

/** Rows to show, as a list of objects. */
export class TableElement extends TransformingDisplay {
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
      guard: 'Please describe how to turn the incoming data into rows first.',
      success: '✅ Transform generated!',
    };
  }
}
