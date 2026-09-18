import React, { useEffect, useRef } from 'react';
import type { WidgetViewProps } from '../WidgetView';
import Markdown from '@/ui/Markdown';
import { ACCENT_FILL, DIMMER, FIELD, LINE, MUTED, PRIMARY_BUTTON, SUNKEN, TEXT } from '@/ui/theme';

interface ChatMessage { role: 'user' | 'assistant'; text: string }
interface ChatValue { messages: ChatMessage[]; pending: string }

/** The block's stored value, whatever state an older file or an empty block left it in. */
function read(value: unknown): ChatValue {
  const stored = (value && typeof value === 'object' ? value : {}) as Partial<ChatValue>;
  return {
    messages: Array.isArray(stored.messages) ? stored.messages.filter((m) => typeof m?.text === 'string') : [],
    pending: typeof stored.pending === 'string' ? stored.pending : '',
  };
}

/**
 * Runtime chat widget: the conversation, and the box that continues it.
 *
 * **What is typed is the block's value**, as it is for every other box on a
 * page -- `pending`, the message nobody has answered yet. It used to live in
 * this component until Send was pressed, which made Send the only way to say
 * anything: ▶ Run, the graph's clock and a button wired elsewhere all ran the
 * graph with an empty message while the sentence sat in a text box the graph
 * could not see. Now every way of running sends what is there.
 *
 * The turn is written into the transcript when the answer arrives (the
 * engine's `ChatWidget.settle`), which also empties `pending`. A run that
 * fails leaves it, so the message is still in the box to send again.
 */
export default function ChatWidgetView({ value, onChange, onTrigger, busy }: WidgetViewProps) {
  const { messages, pending } = read(value);
  const end = useRef<HTMLDivElement | null>(null);
  // While its answer is on the way the message is shown as said, not as being typed.
  const sending = busy === true && pending.trim() !== '';

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, sending]);

  const send = () => {
    if (busy || !pending.trim()) return;
    const next: ChatValue = { messages, pending: pending.trim() };
    if (onTrigger) onTrigger(next);
    else onChange(next);
  };

  const bubble = (message: ChatMessage, key: React.Key) => (
    <div key={key} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className="rounded-2xl px-3 py-2 text-sm max-w-[85%] min-w-0"
        style={message.role === 'user'
          ? { background: ACCENT_FILL, color: TEXT, borderBottomRightRadius: 4 }
          : { background: SUNKEN, color: TEXT, border: `1px solid ${LINE}`, borderBottomLeftRadius: 4 }}
      >
        {message.role === 'user'
          ? <span className="whitespace-pre-wrap">{message.text}</span>
          : <Markdown source={message.text} />}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-2 pr-1" style={{ minHeight: 60 }}>
        {messages.length === 0 && !sending && (
          <div className="m-auto text-sm" style={{ color: DIMMER }}>Say something to start.</div>
        )}
        {messages.map((message, index) => bubble(message, index))}
        {sending && bubble({ role: 'user', text: pending }, 'pending')}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3 py-2 text-sm" style={{ background: SUNKEN, color: MUTED, border: `1px solid ${LINE}` }}>
              <span className="chat-typing">●●●</span>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      <div className="flex items-end gap-2 flex-shrink-0">
        <textarea
          className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm resize-none"
          style={{ ...FIELD, height: 40 }}
          value={sending ? '' : pending}
          disabled={sending}
          onChange={(e) => onChange({ messages, pending: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            send();
          }}
          placeholder="Message…  (Enter sends, Shift+Enter for a new line)"
          aria-label="Message"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !pending.trim()}
          className="rounded-lg px-4 text-sm font-medium flex-shrink-0"
          style={{ ...PRIMARY_BUTTON, height: 40, opacity: busy || !pending.trim() ? 0.5 : 1 }}
        >
          Send
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => onChange({ messages: [], pending })}
            disabled={busy}
            className="rounded-lg px-3 text-xs flex-shrink-0"
            style={{ height: 40, color: MUTED, border: `1px solid ${LINE}`, background: 'transparent' }}
            title="Forget this conversation and start a new one"
          >
            New chat
          </button>
        )}
      </div>
    </div>
  );
}
