/**
 * Context strings handed to the AI that more than one editor needs.
 *
 * The directory file-selector contract is implemented once in the backend
 * (`InputElement` and `InputPickerElement` both run `run(inputs) -> {files}`),
 * so the sentence describing it to the model belongs in one place too -- it was
 * byte-identical in NodeEditor.tsx and GuiWidgetEditor.tsx, which is exactly
 * how two copies of a prompt start drifting.
 */
export const SELECTOR_CODE_CONTEXT =
  '`inputs["files"]` is the full list of rooted file paths found in the directory. ' +
  'Return only the selected paths as {"files": [...]}.';

/**
 * The plot_window widget's data-transform contract (same as a Code node).
 *
 * The chart itself is drawn by the app (`PlotWidget.tsx`, a dependency-free
 * SVG renderer), so the transform must NOT plot anything — it only reshapes
 * the incoming value into the points PlotWidget understands. Spelling that
 * out matters: without it, models reliably reach for matplotlib, which isn't
 * installed in the sandbox and whose figures aren't JSON-serializable anyway.
 */
export const PLOT_TRANSFORM_CONTEXT =
  'Must expose run(inputs: dict) -> dict, receiving {"value": <raw incoming data>} ' +
  'and returning {"value": <plot-ready data>}. Plot-ready data is a JSON-serializable ' +
  'list of points: either a list of numbers, or a list of {"label": str, "value": number} ' +
  'objects. The app renders these itself as an SVG bar/line chart — do NOT draw anything ' +
  'and do NOT import plotting or third-party libraries (no matplotlib, plotly, pandas, ' +
  'numpy): the code runs in a sandbox with only the standard library available.';
