import { lazy } from 'react';
import type { WidgetUi } from '../../ElementUi';
import InputPickerWidgetView from './InputPickerWidgetView';
import { InputPickerWidget } from '@engine/elements/widgets/input_picker/InputPickerWidget.ts';
import { fromEngine } from '@/authoring/generation';

export const inputPickerWidgetUi: WidgetUi = {
  widgetKind: 'input_picker',
  // The same declaration the input node carries, because it is the same
  // behaviour one level down -- the backend returns literally the same object.
  generation: {
    ...fromEngine(new InputPickerWidget().generation()),
    available: (widget) => widget.mode === 'directory',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    mono: true,
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
    bodyHeight: 100,
  },
  Panel: lazy(() => import('./InputPickerWidgetPanel')),
  View: InputPickerWidgetView,
};
