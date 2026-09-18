import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { PRIMARY_BUTTON } from '../../../ui/theme';

/**
 * Runtime button widget: a press starts the graph where the button is wired to.
 *
 * It also counts, and the count is what its port carries -- for a node that
 * wants to know how often rather than merely when.
 */
export default function ButtonWidget({ widget, value, onChange, onTrigger, busy }: GuiWidgetRuntimeProps) {
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
