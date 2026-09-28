import { lazy } from 'react';
import type { GuiWidget } from '@/graph';
import { WidgetGuiBuilder } from '../../WidgetGuiBuilder';

export class InputPickerWidgetGuiBuilder extends WidgetGuiBuilder {
  readonly widgetKind = 'input_picker';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'File or folder';

  paletteEntries() {
    return [{ label: this.label, icon: '📂', also: 'picker open browse upload' }];
  }

  /** One palette entry for both modes; in a sentence, the one it is in. */
  override called(widget: GuiWidget): string {
    return widget.mode === 'directory' ? 'folder picker' : 'file picker';
  }

  override readonly Panel = lazy(() => import('./InputPickerWidgetPanel'));

  override readonly defaultMode = 'file';

  override readonly runOnChangeHint =
    'Picking a file or folder (or Enter in the path box) runs the nodes this picker is wired to.';

  /**
   * A picker is a source like an input node listing a folder, with no input port:
   * nothing upstream can feed it, and nothing describes what it holds until a
   * person gives it a default path.
   */
  override missingExample(widget: GuiWidget): boolean {
    return !String(widget.value ?? '').trim();
  }

  /**
   * Room for its caption and its path box beside 📂: at 6 x 2 the designer at
   * 1024 pixels -- cells of 13 pixels there -- drew the path box 18 pixels
   * wide and the row it stands in 6 pixels high.
   */
  protected override defaultSpan() {
    return { w: 8, h: 3 };
  }

  /** Its path, and for a folder the file types it keeps and whether it looks into subfolders. */
  protected override initialSettings(): Partial<GuiWidget> {
    return { value: '', extensions: '', recursive: false };
  }

  /** A field you operate looks like a field, or nobody clicks it. */
  protected override defaultTone() {
    return 'sunken' as const;
  }
}
