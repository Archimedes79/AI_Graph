import { WidgetElement, type Widget } from '../../WidgetElement.ts';
import type { RawConfig } from '../../../graph.ts';
import { port } from '../../port.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatConfig {
  /** Everything said so far, oldest first. */
  messages: ChatMessage[];
  /** What the person just sent and nobody has answered yet. */
  pending: string;
}

function read(raw: unknown): ChatConfig {
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

/** The conversation as a model reads it: one turn per paragraph, who said it in front. */
export function transcript(messages: ChatMessage[]): string {
  return messages
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.text}`)
    .join('\n\n');
}

/**
 * A conversation: what was said, a box to say the next thing, and the answer
 * coming back into it.
 *
 * A chat used to be assembled from parts -- a text box, a data node to hold
 * the transcript, a code node to append to it, another to build the prompt --
 * five nodes to do what everyone means by one word. The transcript is this
 * block's own value instead, which makes a chatbot the page and a model, wired
 * in a loop: `message` and `history` out, the reply back in.
 *
 * The turn is only written down **when the answer arrives**. Until then the
 * message is `pending`: a model call that fails leaves the conversation
 * exactly as it was, with the message still in hand to send again, rather
 * than a transcript ending in a question nobody answered.
 */
export class ChatWidget extends WidgetElement<ChatConfig> {
  readonly widgetKind = 'chat' as const;

  config(widget: Widget): ChatConfig {
    return read(widget.config.value);
  }

  ports(widget: Widget) {
    const name = widget.label || widget.id;
    return {
      inputs: [port(`${widget.id}_in`, `${name}: reply`, 'input', 'any', false,
        'The answer to the message just sent. It is added to the conversation.')],
      outputs: [
        port(`${widget.id}_out`, `${name}: message`, 'output', 'text', false,
          'What the person just sent. Sending it starts the graph from whatever this is wired to.'),
        port(`${widget.id}_history`, `${name}: history`, 'output', 'text', false,
          'Everything said before this message, one turn per paragraph.'),
      ],
    };
  }

  /** Sending is the event. A chat that waited for someone to press Run would not be one. */
  override firesRun(): boolean {
    return true;
  }

  async execute(widget: Widget) {
    const { messages, pending } = this.config(widget);
    return {
      [`${widget.id}_out`]: pending,
      [`${widget.id}_history`]: transcript(messages),
    };
  }

  /** The reply closes the turn: question and answer go into the transcript together. */
  override settle(stored: RawConfig, value: unknown): void {
    const { messages, pending } = read(stored.value);
    const reply = Array.isArray(value) ? value.map(String).join('\n\n') : String(value ?? '');
    if (!reply.trim()) return;
    stored.value = {
      messages: [
        ...messages,
        ...(pending ? [{ role: 'user', text: pending }] : []),
        { role: 'assistant', text: reply },
      ],
      pending: '',
    };
  }
}
