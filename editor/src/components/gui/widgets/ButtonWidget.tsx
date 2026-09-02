import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { PRIMARY_BUTTON } from '../../../ui/theme';

/**
 * Runtime button widget: each press adds one to its own count.
 *
 * There is no live channel into a running graph — pressing this does not
 * start a run by itself. What it leaves behind is the number of presses since
 * the count was last read, for whatever a downstream node does with it on the
 * next run.
 */
export default function ButtonWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const count = typeof value === 'number' && Number.isFinite(value) ? value : 0;

  return (
    <button
      type="button"
      className="w-full h-full rounded-lg text-sm font-medium"
      style={PRIMARY_BUTTON}
      onClick={() => onChange(String(count + 1))}
    >
      {widget.label || 'Press'}
    </button>
  );
}
