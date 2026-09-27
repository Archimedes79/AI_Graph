// What a chat block holds: the conversation so far and the message in hand.
//
// Its own tiny module, like `text_io/role.ts`, because the page imports it too:
// a run reads the stored value to send the message and the history, and the
// page reads it to draw the bubbles. The page had a copy of its own, which
// kept a message's role as it was stored, so a turn a run sent as the
// person's could be drawn on the assistant's side.

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatValue {
  /** Everything said so far, oldest first. */
  messages: ChatMessage[];
  /** What the person just sent and nobody has answered yet. */
  pending: string;
}

/** The block's stored value, whatever state an older file or an empty block left it in. */
export function chatValue(raw: unknown): ChatValue {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as { messages?: unknown; pending?: unknown };
  const messages = Array.isArray(stored.messages) ? stored.messages : [];
  return {
    messages: messages
      .map((entry) => entry as Partial<ChatMessage>)
      .filter((entry) => typeof entry?.text === 'string')
      .map((entry) => ({ role: entry.role === 'assistant' ? 'assistant' as const : 'user' as const, text: String(entry.text) })),
    pending: typeof stored.pending === 'string' ? stored.pending : '',
  };
}
