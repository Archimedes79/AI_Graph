import type { GuiWidgetElementDefinition } from '../../../types';
import FileOpenEditor from '../../../../components/widgets/editors/FileOpenEditor';
import FileOpenWidget from '../../../../components/gui/widgets/FileOpenWidget';

/**
 * Reference implementation for AGENTS.md's element contract -- every other
 * GuiWidgetElementDefinition should look structurally identical to this one.
 */
export const fileOpenElement: GuiWidgetElementDefinition = {
  widgetKind: 'file_open',
  ports: (widget) => {
    const outId = `${widget.id}_out`;
    const label = widget.label || widget.id;
    return {
      inputs: [],
      outputs: [{ id: outId, name: label, kind: 'output', data_type: 'file_path', multi: false, required: false, description: '' }],
    };
  },
  ConfigEditor: FileOpenEditor,
  RuntimeWidget: FileOpenWidget,
};
