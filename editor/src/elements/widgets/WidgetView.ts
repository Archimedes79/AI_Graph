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
   * call -- the page asks the engine (`firesRun`) -- so a block reports every
   * such moment and does not look at its own settings to decide.
   *
   * `value` is what the block holds as of this event. Passed along rather than
   * read back, because the event and the last keystroke arrive in one tick and
   * a run that started from the stored value would send the message minus its
   * final letter.
   */
  onTrigger?: (value?: unknown) => void;
  /** A run is in flight. For a block that shows waiting: a chat's typing dots. */
  busy?: boolean;
}

/** Best-effort rendering of an arbitrary port value as display text. */
export function valueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  // A list of names reads as lines; a list of paragraphs -- a summary per file --
  // needs air between them, or three answers read as one.
  if (Array.isArray(value)) {
    const items = value.map(valueToText);
    return items.join(items.some((item) => item.length > 80) ? '\n\n' : '\n');
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
