import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';

function effectiveMode(widget: { mode?: string; kind?: string }): 'input' | 'output' | 'both' {
  if (widget.mode === 'input' || widget.mode === 'output' || widget.mode === 'both') return widget.mode;
  return 'both';
}

/** Runtime text_io widget.
 * - "input": text area the user types in (drives graph via output port)
 * - "output": read-only display of incoming value
 * - "both": shows incoming value above, user text area below
 */
export default function TextIoWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const mode = effectiveMode(widget);
  const text = valueToText(value);

  if (mode === 'output') {
    return (
      <textarea
        className="w-full h-full rounded-lg px-2 py-1.5 text-sm resize-none"
        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 80 }}
        value={text}
        readOnly
        placeholder="Waiting for output…"
      />
    );
  }

  if (mode === 'input') {
    return (
      <textarea
        className="w-full h-full rounded-lg px-2 py-1.5 text-sm resize-none"
        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 80 }}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your input…"
      />
    );
  }

  // "both": show incoming display text above, editable user text below
  // The `value` prop here is the widget's own stored value (user text).
  // Incoming (displayed) value comes from the node result via GuiWindow and is
  // passed in `value` only when no widget.value override applies — so we use
  // separate read/write halves.
  return (
    <div className="flex flex-col gap-2 h-full">
      <div
        className="flex-1 rounded-lg px-2 py-1.5 text-sm overflow-auto"
        style={{ background: '#0a0c12', color: '#94a3b8', border: '1px solid #1e2235', minHeight: 40 }}
      >
        {text || <span style={{ color: '#334155' }}>Incoming value appears here…</span>}
      </div>
      <textarea
        className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 60 }}
        value={valueToText(widget.value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your message…"
      />
    </div>
  );
}
