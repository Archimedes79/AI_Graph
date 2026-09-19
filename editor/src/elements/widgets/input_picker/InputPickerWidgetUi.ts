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
  override readonly runOnChangeHint =
    'Picking a file or folder (or Enter in the path box) runs the nodes this picker is wired to.';

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

  /**
   * A picker is a source like an input node in file mode, with no input port:
   * nothing upstream can feed it, and nothing describes what it holds until a
   * person gives it a default path.
   */
  override missingExample(widget: GuiWidget): boolean {
    return !String(widget.value ?? '').trim();
  }

  protected override defaultSpan() {
    return { w: 6, h: 2 };
  }

  /** A field you operate looks like a field, or nobody clicks it. */
  protected override defaultTone() {
    return 'sunken' as const;
  }
}
