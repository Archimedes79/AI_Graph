import type { GuiWidgetElementDefinition } from '../../../types';
import PlotWindowEditor from './PlotWindowEditor';
import PlotWindowWidget from '../../../../components/gui/widgets/PlotWindowWidget';

export const plotWindowElement: GuiWidgetElementDefinition = {
  widgetKind: 'plot_window',
  // Display-only, like text_output: accepts data to plot, no downstream port.
  ports: (widget) => {
    const inId = `${widget.id}_in`;
    const label = widget.label || widget.id;
    return {
      inputs: [{ id: inId, name: label, kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
      outputs: [],
    };
  },
  ConfigEditor: PlotWindowEditor,
  RuntimeWidget: PlotWindowWidget,
};
