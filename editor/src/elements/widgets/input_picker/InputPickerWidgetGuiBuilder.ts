import { lazy } from 'react';
import type { GuiWidget } from '@/graph';
import type { ElementGeneration } from '@/authoring/generation';
import { selectorGeneration } from '@/authoring/selectorGeneration';
import { runBlockAlone } from '@/authoring/blockStepRules';
import { InputPickerWidgetRunner } from '@engine/elements/widgets/input_picker/InputPickerWidgetRunner.ts';
import { parseWidget } from '@engine/elements/nodes/gui/GuiNodeRunner.ts';
import { WidgetGuiBuilder } from '../../WidgetGuiBuilder';

const PICKER = new InputPickerWidgetRunner();

export class InputPickerWidgetGuiBuilder extends WidgetGuiBuilder {
  readonly widgetKind = 'input_picker';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'File or folder';

  paletteEntries() {
    return [{ label: this.label, icon: '📂', also: 'picker open browse upload' }];
  }

  override readonly Panel = lazy(() => import('./InputPickerWidgetPanel'));

  override readonly defaultMode = 'file';

  override readonly runOnChangeHint =
    'Picking a file or folder (or Enter in the path box) runs the nodes this picker is wired to.';

  // The same declaration the input node carries, because it is the same
  // behaviour one level down -- the engine returns literally the same object.
  override readonly generation: ElementGeneration<GuiWidget> = selectorGeneration(PICKER.generation(), {
    isFolder: (widget) => widget.mode === 'directory',
    selectsAll: (widget) => this.selectsAll(widget),
    bodyHeight: 100,
    // The selector is handed the folder's listing, and that listing is its
    // example: the block's own, made by the block run by itself, the way a
    // run makes it -- fetched when it is asked for.
    fetchSample: async (widget) => {
      const folder = String(widget.value ?? '').trim();
      if (!folder) return undefined;
      const listed = await runBlockAlone({ ...widget, mode: 'directory', select_all_files: true });
      if (listed.status === 'error') throw new Error(listed.error || `${folder} could not be listed.`);
      return { values: { files: Array.isArray(listed.shown) ? listed.shown : [] }, origin: `the listing of ${folder}` };
    },
  });

  /**
   * A picker is a source like an input node in file mode, with no input port:
   * nothing upstream can feed it, and nothing describes what it holds until a
   * person gives it a default path.
   */
  override missingExample(widget: GuiWidget): boolean {
    return !String(widget.value ?? '').trim();
  }

  /**
   * Whether a run takes every file the folder lists, and runs no selector:
   * the engine's answer, asked of the engine. A picker without the key --
   * written by ✨, by hand or over MCP -- takes them all; the panel read the
   * missing key as "no", offered a selector to write, and every run went on
   * emitting the whole folder.
   */
  selectsAll(widget: GuiWidget): boolean {
    return PICKER.config(parseWidget(widget)).selectAll;
  }

  protected override defaultSpan() {
    return { w: 6, h: 2 };
  }

  /** Its path, what a folder lists, and the selector that narrows the list -- which takes every file until asked not to. */
  protected override initialSettings(): Partial<GuiWidget> {
    return { value: '', extensions: '', recursive: false, select_all_files: true, selector_prompt: '', selector_code: '' };
  }

  /** A field you operate looks like a field, or nobody clicks it. */
  protected override defaultTone() {
    return 'sunken' as const;
  }
}
