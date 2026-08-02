import type { GuiWidgetElementDefinition } from '../../../types';
import TextChatEditor from '../../../../components/widgets/editors/TextChatEditor';
import TextWindowWidget from '../../../../components/gui/widgets/TextWindowWidget';

export const textWindowElement: GuiWidgetElementDefinition = {
  widgetKind: 'text_window',
  ports: (widget) => {
    const inId = `${widget.id}_in`;
    const outId = `${widget.id}_out`;
    const label = widget.label || widget.id;
    return {
      inputs: [{ id: inId, name: label, kind: 'input', data_type: 'any', multi: false, required: false, description: '' }],
      outputs: [{ id: outId, name: label, kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    };
  },
  ConfigEditor: TextChatEditor,
  RuntimeWidget: TextWindowWidget,
};
