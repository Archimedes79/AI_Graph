import React from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';
import { effectiveTextIoMode } from '@engine/elements/gui/children/text_io/editor/mode';
import { DIMMER, FIELD, LINE, SUNKEN, TEXT } from '../../../ui/theme';

/** Runtime text_io widget.
 * - "input": text area the user types in (drives graph via output port)
 * - "output": read-only display of incoming value
 * - "both": shows incoming value above, user text area below
 */
export default function TextIoWidget({ widget, value, incoming, onChange, onTrigger }: GuiWidgetRuntimeProps) {
  const mode = effectiveTextIoMode(widget);
  const text = valueToText(value);
  // In a box that sends, Enter sends and Shift+Enter is the newline -- what
  // every messenger does. In one that does not, Enter is just a newline.
  const sends = widget.run_on_change === true;
  const sendOnEnter = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!sends || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const typed = event.currentTarget.value;
    if (typed.trim()) onTrigger?.(typed);
  };

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
        onKeyDown={sendOnEnter}
        placeholder={sends ? 'Type and press Enter…' : 'Type your input…'}
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
        style={{ background: SUNKEN, color: TEXT, border: `1px solid ${LINE}`, minHeight: 40 }}
      >
        {incomingText || <span style={{ color: DIMMER }}>Incoming value appears here…</span>}
      </div>
      <textarea
        className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
        style={{ ...FIELD, minHeight: 60 }}
        value={valueToText(value)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={sendOnEnter}
        placeholder="Your message…"
      />
    </div>
  );
}
