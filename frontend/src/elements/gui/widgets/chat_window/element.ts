import type { GuiWidgetElementDefinition } from '../../../types';
import TextChatEditor from '../../../../components/widgets/editors/TextChatEditor';
import ChatWindowWidget from '../../../../components/gui/widgets/ChatWindowWidget';

export const chatWindowElement: GuiWidgetElementDefinition = {
  widgetKind: 'chat_window',
  ports: (widget) => {
    const inId = `${widget.id}_in`;
    const outId = `${widget.id}_out`;
    const label = widget.label || widget.id;
    return {
      inputs: [{ id: inId, name: label, kind: 'input', data_type: 'text', multi: true, required: false, description: '' }],
      outputs: [{ id: outId, name: label, kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    };
  },
  ConfigEditor: TextChatEditor,
  RuntimeWidget: ChatWindowWidget,
};
