import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { PlotWindowWidgetRunner } from '@engine/elements/widgets/plot_window/PlotWindowWidgetRunner.ts';
import { TransformingDisplayGuiBuilder } from '../TransformingDisplayGuiBuilder';
import PlotCanvasPreview from './PlotCanvasPreview';

export class PlotWindowWidgetGuiBuilder extends TransformingDisplayGuiBuilder {
  readonly widgetKind = 'plot_window';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Chart';

  paletteEntries() {
    return [{ label: this.label, icon: '📊', also: 'plot graph diagram svg' }];
  }

  readonly runner = new PlotWindowWidgetRunner();

  // Its own sentence, not what `runner.draws()` says: that is for the node
  // upstream, which must hand data and never SVG, while draw() here may
  // return SVG, drawn at the block's real size.
  readonly shows = 'What draw(data, window) returns is what the chart shows: a list of numbers or of {"label", "value"} points, a figure {"kind": "bars", "columns", "line" or "donut", "title", "points"}, or a string of SVG. It runs in the page, so it is handed the block’s real size in pixels and the page’s colour scheme, and is called again whenever either changes; `data` is null until something has arrived.';

  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(this.runner.generation()),
    promptLabel: 'What the chart should show',
    promptPlaceholder: 'e.g. the temperature per hour as a line, the hours along the bottom',
    bodyLabel: 'Code — draw(data, window) returns what to show',
    bodyHeight: 100,
  };

  /** What last arrived on this widget's input port, charted on the graph canvas itself -- by its own draw(). */
  override readonly CanvasPreview = PlotCanvasPreview;
}
