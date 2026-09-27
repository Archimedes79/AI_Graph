import { PlotWindowWidgetRunner } from '@engine/elements/widgets/plot_window/PlotWindowWidgetRunner.ts';
import { DisplayWidgetGuiBuilder } from '../DisplayWidgetGuiBuilder';
import PlotChart from './PlotChart';

export class PlotWindowWidgetGuiBuilder extends DisplayWidgetGuiBuilder {
  readonly widgetKind = 'plot_window';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Chart';

  paletteEntries() {
    return [{ label: this.label, icon: '📊', also: 'plot graph diagram svg' }];
  }

  readonly runner = new PlotWindowWidgetRunner();

  /** What last arrived on this widget's input port, charted small on the graph canvas itself. */
  override readonly CanvasPreview = PlotChart;
}
