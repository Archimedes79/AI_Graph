import type { GuiWidget } from '@/graph';

/**
 * What every widget view is handed (`elements/widgets/<kind>/<Kind>WidgetView.tsx`).
 *
 * The two values are deliberately separate. `value` is what the widget itself
 * holds -- the user's edit, or its stored value -- and is what its `{id}_out`
 * port emits. `incoming` is what arrived on its `{id}_in` port in the last run.
 *
 * Collapsing them into one prop is what made a chat window unusable: the read
 * pane and the write pane both showed `value`, so typing a reply overwrote the
 * answer the user was reading, one character at a time. Widgets that only
 * display (`plot_window`, a read-only text_io) still just take
 * `incoming ?? value`; only the ones that do both need the distinction.
 */
export interface WidgetViewProps {
  widget: GuiWidget;
  value: unknown;
  incoming?: unknown;
  /** Mostly a string; a block that holds more than one thing -- a conversation -- stores an object. */
  onChange: (value: unknown) => void;
  /**
   * The person did the thing this block is *for*: pressed the button, sent the
   * message, made the choice. Whether that starts the graph is not the block's
   * call -- whoever draws the page knows it (`fires`) -- so a block reports
   * every such moment and does not look at its own settings to decide.
   *
   * `value` is what the block holds as of this event. Passed along rather than
   * read back, because the event and the last keystroke arrive in one tick and
   * a run that started from the stored value would send the message minus its
   * final letter.
   */
  onTrigger?: (value?: unknown) => void;
  /**
   * Using this block starts a round, so it waits while one is going. Said by
   * whoever draws the page: a delivered tool by the graph's events, which it
   * is told by name; the editor by the engine.
   */
  fires?: boolean;
  /** A run is in flight. For a block that shows waiting: a chat's typing dots. */
  busy?: boolean;
}
