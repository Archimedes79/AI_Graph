import { TransformingDisplay } from '../display.ts';
import type { Generation } from '../../../../generation.ts';
import { TRANSFORM_FIELDS } from '../display.ts';

/** Points to draw: a list of numbers, or of {label, value}. */
export class PlotWindowElement extends TransformingDisplay {
  readonly widgetKind = 'plot_window' as const;

  /**
   * The transform reshapes data; it must not draw anything.
   *
   * Spelling that out matters: without it, models reliably reach for a plotting
   * library, which is not in the sandbox and whose figures are not
   * JSON-serialisable anyway. The chart is drawn by the app.
   */
  override generation(): Generation {
    return {
      kind: 'code', fields: TRANSFORM_FIELDS,
      contract:
        'Must expose run(inputs) -> object, receiving {"value": <raw incoming data>} '
        + 'and returning {"value": <plot-ready data>}. Plot-ready data is a JSON-serialisable '
        + 'list of points: either a list of numbers, or a list of {"label": string, "value": number} '
        + 'objects. The app renders these itself as an SVG bar/line chart — do NOT draw anything '
        + 'and do NOT import plotting or third-party libraries: the code runs in a sandbox with '
        + 'only the standard library available.',
      inputs: ['value'], outputs: ['value'],
      guard: 'Please describe the chart transform you need first.',
      success: '✅ Transform generated!',
    };
  }
}
