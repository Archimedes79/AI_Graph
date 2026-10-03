import type { WidgetViewProps } from '../WidgetView';
import { PRIMARY_BUTTON } from '@/ui/theme';

/**
 * Runtime button widget: a press starts the graph where the button is wired to.
 *
 * A press is an event, by the button's name, and nothing else: it holds no
 * value a round could be given (`ButtonWidgetRunner.takesValue`). What its
 * port carries in the graph is whether it was pressed just now: true in the
 * round the press started, false in any other.
 */
export default function ButtonWidgetView({ widget, onTrigger, busy }: WidgetViewProps) {
  return (
    <button
      type="button"
      className="w-full h-full rounded-lg text-sm font-medium"
      style={{ ...PRIMARY_BUTTON, opacity: busy ? 0.6 : 1 }}
      disabled={busy}
      onClick={() => onTrigger?.()}
    >
      {widget.label || 'Press'}
    </button>
  );
}
