import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';

/** Runtime `text_window` widget: shows what flowed into `{id}_in`, editable. */
export default function TextWindowWidget({ value, onChange }: GuiWidgetRuntimeProps) {
  const text = valueToText(value);

  return (
    <textarea
      className="w-full h-full rounded-lg px-2 py-1.5 text-sm resize-none outline-none"
      style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 60 }}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Waiting for input…"
      spellCheck={false}
    />
  );
}
