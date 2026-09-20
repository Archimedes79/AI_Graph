import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { PlotWindowWidgetElement } from '@engine/elements/widgets/plot_window/PlotWindowWidgetElement.ts';
import { TransformingDisplayUi } from '../TransformingDisplayUi';
import PlotChart from './PlotChart';

export class PlotWindowWidgetUi extends TransformingDisplayUi {
  readonly widgetKind = 'plot_window';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Chart';

  // Not "(optional)". It is optional in exactly one case -- what arrives is
  // already a list of points -- and calling it optional in general told people
  // an empty box was a finished block, which draws nothing.
  readonly transformTitle = 'Plotting code';

  readonly transformHelp = 'draw(data, window) returns what to show: a list of numbers or of {"label", "value"} objects, or a string of SVG. It runs in the page rather than in a run, so it is handed the real size of this block in pixels and the page’s colour scheme, and it is called again whenever either of them changes. `data` is null before anything has arrived, and drawing that case is the same function. Leave it empty only if what arrives is already points.';

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(new PlotWindowWidgetElement().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the chart transform you need (axes, grouping, aggregation, filters, etc.)',
    mono: true,
    // "Optional" on its own was a half-truth: without it the widget is handed
    // whatever arrived, and unless that is already a list of points there is
    // nothing to draw.
    bodyLabel: 'draw(data, window) — optional only if the incoming value is already points',
    bodyHeight: 100,
  };

  /** What last arrived on this widget's input port, charted on the graph canvas itself. */
  override readonly CanvasPreview = PlotChart;
}
