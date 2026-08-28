import type { GuiWidgetElementDefinition } from '../../../types';
import InputPickerEditor from './InputPickerEditor';
import InputPickerWidget from '../../../../components/gui/widgets/InputPickerWidget';
import { codeExtension } from '../../../shared/authoredFileName';

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
  authoredFile: (widget) => ({ extension: codeExtension(widget), what: 'this file selector' }),
  // The same declaration the input node carries, because it is the same
  // behaviour one level down -- the backend returns literally the same object.
  generation: {
    promptField: 'selector_prompt',
    targetField: 'selector_code',
    available: (widget) => widget.mode === 'directory',
    guard: 'Please describe which files to select first.',
    success: '✅ Selector generated!',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
    language: true,
    bodyHeight: 100,
  },
  ConfigEditor: InputPickerEditor,
  RuntimeWidget: InputPickerWidget,
};
