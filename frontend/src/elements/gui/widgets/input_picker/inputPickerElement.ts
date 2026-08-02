import type { GuiWidgetElementDefinition } from '../../../types';
import InputPickerEditor from '../../../../components/widgets/editors/InputPickerEditor';
import InputPickerWidget from '../../../../components/gui/widgets/InputPickerWidget';

export const inputPickerElement: GuiWidgetElementDefinition = {
  widgetKind: 'input_picker',
  ports: (widget) => {
    const outId = `${widget.id}_out`;
    const label = widget.label || widget.id;
    // widget.mode wins; legacy directory_open widgets never set mode, so fall back to kind.
    const isDir = widget.mode ? widget.mode === 'directory' : widget.kind === 'directory_open';
    return {
      inputs: [],
      outputs: [{ id: outId, name: label, kind: 'output', data_type: 'file_path', multi: isDir, required: false, description: '' }],
    };
  },
  ConfigEditor: InputPickerEditor,
  RuntimeWidget: InputPickerWidget,
};
