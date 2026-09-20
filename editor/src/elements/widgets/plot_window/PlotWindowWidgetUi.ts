import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { PlotWindowWidgetElement } from '@engine/elements/widgets/plot_window/PlotWindowWidgetElement.ts';
import { TransformingDisplayUi } from '../TransformingDisplayUi';
import PlotWindowWidgetView from './PlotWindowWidgetView';
import PlotChart from './PlotChart';

export class PlotWindowWidgetUi extends TransformingDisplayUi {
  readonly widgetKind = 'plot_window';
  readonly label = 'Chart';
  readonly View = PlotWindowWidgetView;
  // Not "(optional)". It is optional in exactly one case -- what arrives is
  // already a list of points -- and calling it optional in general told people
  // an empty box was a finished block, which draws nothing.
  readonly transformTitle = 'Plotting code';
  readonly transformHelp = 'The code must return {"value": <plot-ready data>} — a list of numbers or of {"label", "value"} objects, or an SVG drawing. It is run on every value that arrives, so answer for an empty or missing one too (an empty list, or empty axes) rather than throwing: that is the chart before anything has been computed. Leave the code empty only if what arrives is already points.';

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(new PlotWindowWidgetElement().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the chart transform you need (axes, grouping, aggregation, filters, etc.)',
    mono: true,
    // "Optional" on its own was a half-truth: without it the widget is handed
    // whatever arrived, and unless that is already a list of points there is
    // nothing to draw.
    bodyLabel: 'Plotting code — optional only if the incoming value is already points',
    bodyHeight: 100,
  };

  /** What last arrived on this widget's input port, charted on the graph canvas itself. */
  override readonly CanvasPreview = PlotChart;
}
