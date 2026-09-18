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
  readonly transformTitle = 'Plotting code (optional)';
  readonly transformHelp = 'The code must return {"value": <plot-ready data>} — a list of numbers or of {"label", "value"} objects, or an SVG drawing. Leave empty to chart the incoming value as-is.';

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
