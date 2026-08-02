import React, { useState } from 'react';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import { valueToText } from '../widgetProps';

/**
 * Runtime `chat_window` widget: incoming messages (the multi `{id}_in` port)
 * are the transcript; the composed message is the widget's own value, which is
 * what `{id}_out` emits on the next run.
 */
export default function ChatWindowWidget({ widget, value, onChange }: GuiWidgetRuntimeProps) {
  const [draft, setDraft] = useState('');
  const incoming = (Array.isArray(value) ? value : [value])
    .map(valueToText)
    .filter((m) => m.length > 0);
  const sent = widget.value ?? '';

  const send = () => {
    const message = draft.trim();
    if (!message) return;
    onChange(message);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div
        className="flex-1 min-h-0 overflow-y-auto rounded-lg px-2 py-2 flex flex-col gap-2"
        style={{ background: '#0f1117', border: '1px solid #2d3148' }}
      >
        {incoming.length === 0 && !sent && (
          <span className="text-xs" style={{ color: '#475569' }}>No messages yet.</span>
        )}
        {incoming.map((message, i) => (
          <div
            key={i}
            className="text-sm px-2 py-1.5 rounded-lg self-start max-w-[85%] whitespace-pre-wrap"
            style={{ background: '#2d1b4e', color: '#e2e8f0' }}
          >
            {message}
          </div>
        ))}
        {sent && (
          <div
            className="text-sm px-2 py-1.5 rounded-lg self-end max-w-[85%] whitespace-pre-wrap"
            style={{ background: '#312e81', color: '#e2e8f0' }}
          >
            {sent}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <input
          className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-sm"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message…"
        />
        <button
          onClick={send}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
          style={{ background: '#6366f1', color: 'white' }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
