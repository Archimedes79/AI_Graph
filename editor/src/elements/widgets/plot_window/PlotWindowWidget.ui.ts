import { lazy } from 'react';
import type { WidgetUi } from '../../ElementUi';
import PlotWindowWidgetView from './PlotWindowWidgetView';
import PlotChart from './PlotChart';
import { PlotWindowWidget } from '@engine/elements/widgets/plot_window/PlotWindowWidget.ts';
import { fromEngine } from '@/authoring/generation';

export const plotWindowWidgetUi: WidgetUi = {
  widgetKind: 'plot_window',
  // Display-only, like an `output` node with write_mode="window": accepts data to
  // plot, no downstream port.
  generation: {
    ...fromEngine(new PlotWindowWidget().generation()),
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the chart transform you need (axes, grouping, aggregation, filters, etc.)',
    // "Optional" on its own was a half-truth: without it the block is handed
    // whatever arrived, and unless that is already a list of points there is
    // nothing to draw.
    mono: true,
    bodyLabel: 'Plotting code — optional only if the incoming value is already points',
    bodyHeight: 100,
  },
  // What last arrived on this widget's input port, charted on the graph
  // canvas itself. GraphNodeView used to look for this widget kind by
  // name; it asks the element now.
  CanvasPreview: PlotChart,
  Panel: lazy(() => import('./PlotWindowWidgetPanel')),
  View: PlotWindowWidgetView,
};
