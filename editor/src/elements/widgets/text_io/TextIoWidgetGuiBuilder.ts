import { lazy } from 'react';
import { BOX_TEXT } from '@/document/layout';
import { WidgetGuiBuilder } from '../../WidgetGuiBuilder';

export class TextIoWidgetGuiBuilder extends WidgetGuiBuilder {
  readonly widgetKind = 'text_io';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Text box';

  paletteEntries() {
    return [
      { mode: 'input', label: 'Text input', icon: '⌨️', also: 'field box type prompt' },
      { mode: 'output', label: 'Text output', icon: '📄', also: 'result answer display' },
      { mode: 'both', label: 'Text in & out', icon: '↔️', also: 'both editable' },
    ];
  }

  override readonly Panel = lazy(() => import('./TextIoWidgetPanel'));

  override readonly defaultMode = 'both';

  override readonly runOnChangeHint =
    'Enter sends what was typed (Shift+Enter is a new line), and the box is emptied once it has been delivered.';

  /** What arrives is shown as text in a box, which wraps at its width and scrolls when there is more. */
  override textShown(): string {
    return `${BOX_TEXT.fontSize} px text that wraps and scrolls`;
  }

  /** A box you type into looks like one; a box that only shows text does not. */
  protected override defaultTone(mode: string) {
    return mode === 'output' ? 'plain' as const : 'sunken' as const;
  }

  /** What is typed into it, nothing yet. */
  protected override initialSettings() {
    return { value: '' };
  }
}
