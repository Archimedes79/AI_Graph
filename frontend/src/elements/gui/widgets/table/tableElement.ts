import type { GuiWidgetElementDefinition } from '../../../types';
import TableEditor from './TableEditor';
import TableWidget from '../../../../components/gui/widgets/TableWidget';
import { codeExtension } from '../../../shared/authoredFileName';

/** Display-only, like plot_window: takes rows to show, emits nothing. */
export const tableElement: GuiWidgetElementDefinition = {
  widgetKind: 'table',
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
    guard: 'Please describe how to turn the incoming data into rows first.',
    success: '✅ Transform generated!',
    promptLabel: 'Prompt',
    promptPlaceholder: 'Describe the rows you want, e.g. one row per file with name, size and date.',
    bodyLabel: 'Optional transform — run(inputs) receives {"value"} and returns {"value"}',
    bodyPlaceholder: 'Leave empty to show the incoming rows as-is.',
    language: true,
    bodyHeight: 90,
  },
  ConfigEditor: TableEditor,
  RuntimeWidget: TableWidget,
};
