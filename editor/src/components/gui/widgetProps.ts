import type { GuiWidget } from '../../types/graph';

/**
 * Uniform prop shape for every runtime GUI widget in `gui/widgets/`.
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
export interface GuiWidgetRuntimeProps {
  widget: GuiWidget;
  value: unknown;
  incoming?: unknown;
  onChange: (value: string) => void;
}

/** Best-effort rendering of an arbitrary port value as display text. */
export function valueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(valueToText).join('\n');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
