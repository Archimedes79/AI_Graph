import type { GuiWidgetElementDefinition } from '../../../types';
import PlotWindowEditor from './PlotWindowEditor';
import PlotWindowWidget from '../../../../components/gui/widgets/PlotWindowWidget';
import PlotWidget from '../../../../components/PlotWidget';

export const plotWindowElement: GuiWidgetElementDefinition = {
  widgetKind: 'plot_window',
  // Display-only, like an `output` node with write_mode="window": accepts data to
  // plot, no downstream port.
  authoredFile: (widget) => ({ extension: '.js', what: 'this transform' }),
  generation: {
    promptField: 'code_prompt',
    targetField: 'code',
    guard: 'Please describe the chart transform you need first.',
    success: '✅ Transform generated!',
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
  // canvas itself. GraphNodeComponent used to look for this widget kind by
  // name; it asks the element now.
  CanvasPreview: PlotWidget,
  ConfigEditor: PlotWindowEditor,
  RuntimeWidget: PlotWindowWidget,
};
