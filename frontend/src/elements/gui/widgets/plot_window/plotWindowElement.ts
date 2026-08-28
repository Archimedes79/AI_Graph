import type { GuiWidgetElementDefinition } from '../../../types';
import PlotWindowEditor from './PlotWindowEditor';
import PlotWindowWidget from '../../../../components/gui/widgets/PlotWindowWidget';
import { codeExtension } from '../../../shared/authoredFileName';

export const plotWindowElement: GuiWidgetElementDefinition = {
  widgetKind: 'plot_window',
  // Display-only, like an `output` node with write_mode="window": accepts data to
  // plot, no downstream port.
  ports: (widget) => {
    const inId = `${widget.id}_in`;
    const label = widget.label || widget.id;
    return {
      inputs: [{ id: inId, name: label, kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
      outputs: [],
    };
  },
  authoredFile: (widget) => ({ extension: codeExtension(widget), what: 'this transform' }),
  generation: {
    promptField: 'code_prompt',
    targetField: 'code',
    guard: 'Please describe the chart transform you need first.',
    success: '✅ Transform generated!',
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the chart transform you need (axes, grouping, aggregation, filters, etc.)',
    bodyLabel: 'Plotting code (optional)',
    language: true,
    bodyHeight: 100,
  },
  ConfigEditor: PlotWindowEditor,
  RuntimeWidget: PlotWindowWidget,
};
