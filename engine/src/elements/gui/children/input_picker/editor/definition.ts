import type { GuiWidgetElementDefinition } from '@/elements/types';
import InputPickerEditor from './Editor';
import InputPickerWidget from '@/components/gui/widgets/InputPickerWidget';
import { InputPickerElement } from '../element.ts';
import { fromEngine } from '@/elements/shared/generation';

export const inputPickerElement: GuiWidgetElementDefinition = {
  widgetKind: 'input_picker',
  // The same declaration the input node carries, because it is the same
  // behaviour one level down -- the backend returns literally the same object.
  generation: {
    ...fromEngine(new InputPickerElement().generation()),
    available: (widget) => widget.mode === 'directory',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    mono: true,
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
    bodyHeight: 100,
  },
  ConfigEditor: InputPickerEditor,
  RuntimeWidget: InputPickerWidget,
};
