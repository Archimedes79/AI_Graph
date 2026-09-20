import { WidgetUi } from '../../WidgetUi';

/**
 * A conversation. Nothing to set: what it is wired to is the whole of what it
 * does. Its value is the conversation, which the widget clears turn by turn
 * itself (the engine's `ChatWidgetElement.settle`), so there is no
 * `clearValueAfterRun`.
 */
export class ChatWidgetUi extends WidgetUi {
  readonly widgetKind = 'chat';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Chat';

  /** A conversation needs room to be one: the full width, and most of a screen. */
  protected override defaultSpan() {
    return { w: 16, h: 9 };
  }
}
