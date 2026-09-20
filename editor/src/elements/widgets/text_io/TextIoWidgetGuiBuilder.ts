import { lazy } from 'react';
import { WidgetGuiBuilder } from '../../WidgetGuiBuilder';

export class TextIoWidgetGuiBuilder extends WidgetGuiBuilder {
  readonly widgetKind = 'text_io';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Text box';

  override readonly Panel = lazy(() => import('./TextIoWidgetPanel'));

  override readonly defaultMode = 'both';

  override readonly runOnChangeHint =
    'Enter sends what was typed (Shift+Enter is a new line), and the box is emptied once it has been delivered.';

  /** A box you type into looks like one; a box that only shows text does not. */
  protected override defaultTone(mode: string) {
    return mode === 'output' ? 'plain' as const : 'sunken' as const;
  }
}
