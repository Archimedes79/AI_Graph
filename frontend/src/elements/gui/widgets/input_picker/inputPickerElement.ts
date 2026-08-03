import type { GuiWidgetElementDefinition } from '../../../types';
import InputPickerEditor from './InputPickerEditor';
import InputPickerWidget from '../../../../components/gui/widgets/InputPickerWidget';

export const inputPickerElement: GuiWidgetElementDefinition = {
  widgetKind: 'input_picker',
  ports: (widget) => {
    const outId = `${widget.id}_out`;
    const label = widget.label || widget.id;
    const isDir = widget.mode === 'directory';
    return {
      inputs: [],
      outputs: [{ id: outId, name: label, kind: 'output', data_type: 'file_path', multi: isDir, required: false, description: '' }],
    };
  },
  ConfigEditor: InputPickerEditor,
  RuntimeWidget: InputPickerWidget,
};
