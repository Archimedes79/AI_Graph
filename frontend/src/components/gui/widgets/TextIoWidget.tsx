import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';
import { effectiveTextIoMode } from '../../../elements/gui/widgets/text_io/mode';
import { FIELD, MUTED } from '../../../ui/theme';

/** Runtime text_io widget.
 * - "input": text area the user types in (drives graph via output port)
 * - "output": read-only display of incoming value
 * - "both": shows incoming value above, user text area below
 */
export default function TextIoWidget({ widget, value, incoming, onChange }: GuiWidgetRuntimeProps) {
  const mode = effectiveTextIoMode(widget);
  const text = valueToText(value);

  if (mode === 'output') {
    return (
      <textarea
        className="w-full h-full rounded-lg px-2 py-1.5 text-sm resize-none"
        style={{ ...FIELD, minHeight: 80 }}
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
        style={{ ...FIELD, minHeight: 80 }}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your input…"
      />
    );
  }

  // "both": the last run's reply above, the user's next message below. The two
  // panes read different props on purpose -- feeding both from one value is
  // what used to make the reply disappear as soon as the user started typing.
  const incomingText = valueToText(incoming);
  return (
    <div className="flex flex-col gap-2 h-full">
      <div
        className="flex-1 rounded-lg px-2 py-1.5 text-sm overflow-auto whitespace-pre-wrap"
        style={{ background: '#0a0c12', color: MUTED, border: '1px solid #1e2235', minHeight: 40 }}
      >
        {incomingText || <span style={{ color: '#334155' }}>Incoming value appears here…</span>}
      </div>
      <textarea
        className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
        style={{ ...FIELD, minHeight: 60 }}
        value={valueToText(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your message…"
      />
    </div>
  );
}
