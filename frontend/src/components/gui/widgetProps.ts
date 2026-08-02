import type { GuiWidget } from '../../types/graph';

/**
 * Uniform prop shape for every runtime GUI widget in `gui/widgets/`.
 * `value` is what flowed into the widget's `{id}_in` port on the last run
 * (falling back to the widget's stored value); `onChange` writes the widget's
 * value back into the graph, which is what its `{id}_out` port emits.
 */
export interface GuiWidgetRuntimeProps {
  widget: GuiWidget;
  value: unknown;
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
