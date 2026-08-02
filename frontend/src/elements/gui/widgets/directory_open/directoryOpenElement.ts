import type { GuiWidgetElementDefinition } from '../../../types';
import DirectoryOpenEditor from '../../../../components/widgets/editors/DirectoryOpenEditor';
import DirectoryOpenWidget from '../../../../components/gui/widgets/DirectoryOpenWidget';

export const directoryOpenElement: GuiWidgetElementDefinition = {
  widgetKind: 'directory_open',
  ports: (widget) => {
    const outId = `${widget.id}_out`;
    const label = widget.label || widget.id;
    return {
      inputs: [],
      outputs: [{ id: outId, name: label, kind: 'output', data_type: 'file_path', multi: true, required: false, description: '' }],
    };
  },
  ConfigEditor: DirectoryOpenEditor,
  RuntimeWidget: DirectoryOpenWidget,
};
