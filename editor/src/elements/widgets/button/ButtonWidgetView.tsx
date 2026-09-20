import type { WidgetViewProps } from '../WidgetView';
import { PRIMARY_BUTTON } from '@/ui/theme';

/**
 * Runtime button widget: a press starts the graph where the button is wired to.
 *
 * It counts its presses so that every press is a change the page reports. What
 * its port carries in the graph is not the count but whether it was pressed
 * just now: true in the round the press started, false in any other.
 */
export default function ButtonWidgetView({ widget, value, onChange, onTrigger, busy }: WidgetViewProps) {
  const count = Number.isFinite(Number(value)) ? Number(value) : 0;

  return (
    <button
      type="button"
      className="w-full h-full rounded-lg text-sm font-medium"
      style={{ ...PRIMARY_BUTTON, opacity: busy ? 0.6 : 1 }}
      disabled={busy}
      onClick={() => (onTrigger ? onTrigger(count + 1) : onChange(count + 1))}
    >
      {widget.label || 'Press'}
    </button>
  );
}
