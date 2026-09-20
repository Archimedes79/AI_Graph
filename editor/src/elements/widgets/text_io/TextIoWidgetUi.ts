import { lazy } from 'react';
import type { GuiWidget } from '@/graph';
import { WidgetUi } from '../../WidgetUi';
import TextIoWidgetView from './TextIoWidgetView';
import { effectiveTextIoMode } from './mode';

export class TextIoWidgetUi extends WidgetUi {
  readonly widgetKind = 'text_io';

  readonly View = TextIoWidgetView;

  /**
   * A box that sends on Enter holds a message, and a message is said once:
   * clear it when a run has delivered it, so the box is ready for the next
   * one. A box that does not send holds a setting -- a search term, a name --
   * and emptying that after every run would make the person retype it.
   */
  override clearValueAfterRun(widget: GuiWidget): boolean {
    return effectiveTextIoMode(widget) !== 'output' && widget.run_on_change === true;
  }

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
