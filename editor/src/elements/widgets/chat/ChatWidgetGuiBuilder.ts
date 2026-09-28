import { WidgetGuiBuilder } from '../../WidgetGuiBuilder';

/**
 * A conversation. Nothing to set: what it is wired to is the whole of what it
 * does. Its value is the conversation, which the widget clears turn by turn
 * itself (the engine's `ChatWidgetRunner.settle`), not as a box a run empties
 * (`WidgetRunner.clearsValueAfterRun`).
 */
export class ChatWidgetGuiBuilder extends WidgetGuiBuilder {
  readonly widgetKind = 'chat';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Chat';

  paletteEntries() {
    return [{ label: this.label, icon: '💬', also: 'conversation messages bot' }];
  }

  /**
   * A reply is drawn as Markdown (`ChatWidgetView`), headings, lists and
   * tables included -- which the node writing it is better told than left to
   * find out. Not the box text of the default: the reply is Markdown's.
   */
  override textShown(): string {
    return 'replies drawn as Markdown';
  }

  /** A conversation needs room to be one: the full width, and most of a screen. */
  protected override defaultSpan() {
    return { w: 16, h: 9 };
  }
}
