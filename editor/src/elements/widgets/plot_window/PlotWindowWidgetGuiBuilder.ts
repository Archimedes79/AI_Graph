import { PlotWindowWidgetRunner } from '@engine/elements/widgets/plot_window/PlotWindowWidgetRunner.ts';
import { DisplayWidgetGuiBuilder } from '../DisplayWidgetGuiBuilder';
import { figurePreview, previewOf, type Preview } from '../../resultPreview';
import { toFigure } from './PlotChart';

export class PlotWindowWidgetGuiBuilder extends DisplayWidgetGuiBuilder {
  readonly widgetKind = 'plot_window';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Chart';

  paletteEntries() {
    return [{ label: this.label, icon: '📊', also: 'plot graph diagram svg' }];
  }

  readonly runner = new PlotWindowWidgetRunner();

  /** On a chart, whatever the chart draws is a chart: a list of `{label, value}` points too, which elsewhere is rows. */
  override preview(value: unknown): Preview | undefined {
    const figure = toFigure(value);
    return figure ? figurePreview(figure) : previewOf(value);
  }
}
