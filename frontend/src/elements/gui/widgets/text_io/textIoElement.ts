import type { GuiWidget, Port } from '../../../../types/graph';
import type { GuiWidgetElementDefinition } from '../../../types';
import TextIoWidget from '../../../../components/gui/widgets/TextIoWidget';
import TextIoEditor from './TextIoEditor';
import { effectiveTextIoMode } from './mode';

export const textIoElement: GuiWidgetElementDefinition = {
  widgetKind: 'text_io',
  ports(widget: GuiWidget): { inputs: Port[]; outputs: Port[] } {
    const mode = effectiveTextIoMode(widget);
    const label = widget.label || widget.id;
    const inPort: Port  = { id: `${widget.id}_in`,  name: label, kind: 'input',  data_type: 'any',  multi: false, required: false, description: '' };
    const outPort: Port = { id: `${widget.id}_out`, name: label, kind: 'output', data_type: 'text', multi: false, required: false, description: '' };
    if (mode === 'input')  return { inputs: [],         outputs: [outPort] };
    if (mode === 'output') return { inputs: [inPort],   outputs: []        };
    return                        { inputs: [inPort],   outputs: [outPort] };  // "both"
  },

  ConfigEditor: TextIoEditor,
  RuntimeWidget: TextIoWidget,
  // "input"/"both": the widget's value is the user's typed message, sent once
  // the graph runs -- clear it afterward so the next run doesn't resend the
  // same message, and the box is ready for the next chat turn.
  clearValueAfterRun: (widget) => effectiveTextIoMode(widget) !== 'output',
};
