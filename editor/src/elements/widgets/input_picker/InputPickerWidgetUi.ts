import { lazy } from 'react';
import type { GuiWidget } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { InputPickerWidgetElement } from '@engine/elements/widgets/input_picker/InputPickerWidgetElement.ts';
import { WidgetUi } from '../../WidgetUi';
import InputPickerWidgetView from './InputPickerWidgetView';

export class InputPickerWidgetUi extends WidgetUi {
  readonly widgetKind = 'input_picker';
  readonly label = 'File or folder';
  readonly View = InputPickerWidgetView;
  override readonly Panel = lazy(() => import('./InputPickerWidgetPanel'));
  override readonly defaultMode = 'file';

  // The same declaration the input node carries, because it is the same
  // behaviour one level down -- the engine returns literally the same object.
  override readonly generation: ElementGeneration<GuiWidget> = {
    ...fromEngine(new InputPickerWidgetElement().generation()),
    available: (widget) => widget.mode === 'directory',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Select Markdown files that contain API documentation',
    mono: true,
    bodyLabel: 'Code window (editable) — run(inputs) receives {"files"} and must return {"files"}',
    bodyHeight: 100,
  };

  protected override defaultSpan() {
    return { w: 6, h: 2 };
  }

  /** A field you operate looks like a field, or nobody clicks it. */
  protected override defaultTone() {
    return 'sunken' as const;
  }
}
