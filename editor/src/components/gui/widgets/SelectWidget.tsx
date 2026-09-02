import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { FIELD } from '../../../ui/theme';

/** Runtime select widget: a dropdown over the block's own option list. */
export default function SelectWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const options = String(widget.options ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const current = typeof value === 'string' && options.includes(value) ? value : (options[0] ?? '');

  return (
    <select
      className="w-full rounded-lg px-2 py-1.5 text-sm"
      style={FIELD}
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.length === 0 && <option value="">No options yet</option>}
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
