import { describe, it, expect } from 'vitest';
import { ChatWidget, transcript } from './ChatWidget.ts';
import { parseWidget } from '../../nodes/gui/GuiNode.ts';
import { executeGraph } from '../../../execution/executor.ts';
import { registry } from '../../registry.ts';
import { parseGraph } from '../../../graph.ts';
import type { AiRequest, Runtime } from '../../Runtime.ts';

const chat = new ChatWidget();

describe('ChatWidget', () => {
  it('sends the pending message and what was said before it', async () => {
    const widget = parseWidget({
      id: 'c', kind: 'chat',
      value: { messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], pending: 'how are you?' },
    });
    expect(await chat.execute(widget)).toEqual({
      c_out: 'how are you?',
      c_history: 'User: hi\n\nAssistant: hello',
    });
  });

  it('writes the turn down only when the answer arrives', () => {
    const stored = { id: 'c', kind: 'chat', value: { messages: [], pending: 'hi' } };
    chat.settle(stored, 'hello');
    expect(stored.value).toEqual({
      messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }],
      pending: '',
    });
  });

  it('leaves the conversation alone when nothing came back', () => {
    const stored = { id: 'c', kind: 'chat', value: { messages: [], pending: 'hi' } };
    chat.settle(stored, '');
    expect(stored.value).toEqual({ messages: [], pending: 'hi' });
  });

  it('starts from nothing on a block nobody has used', async () => {
    expect(await chat.execute(parseWidget({ id: 'c', kind: 'chat', value: '' }))).toEqual({ c_out: '', c_history: '' });
  });

  it('always starts the graph: sending is the event', () => {
    expect(chat.firesRun()).toBe(true);
  });

  it('labels each turn for the model', () => {
    expect(transcript([{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }])).toBe('User: a\n\nAssistant: b');
  });
});

describe('a chatbot is a page and a model', () => {
  const graph = () => parseGraph({
    nodes: [
      {
        id: 'page', node_type: 'gui',
        config: { gui_widgets: [{ id: 'chat', kind: 'chat', value: { messages: [], pending: 'What is 2+2?' } }] },
      },
      {
        id: 'ai', node_type: 'ai',
        inputs: [{ id: 'history', name: 'history' }, { id: 'message', name: 'message' }],
        outputs: [{ id: 'output', name: 'output' }],
        config: { ai_model: 'm', prompt_template: '{{history}}\n\nUser: {{message}}' },
      },
    ],
    edges: [
      { id: 'e1', source_node_id: 'page', source_port_id: 'chat_out', target_node_id: 'ai', target_port_id: 'message' },
      { id: 'e2', source_node_id: 'page', source_port_id: 'chat_history', target_node_id: 'ai', target_port_id: 'history' },
      { id: 'e3', source_node_id: 'ai', source_port_id: 'output', target_node_id: 'page', target_port_id: 'chat_in' },
    ],
  });

  it('remembers the turn, and sends it as history with the next one', async () => {
    const asked: AiRequest[] = [];
    const runtime: Runtime = {
      files: {} as never,
      code: { run: async (_body, inputs) => inputs },
      ai: { complete: async (request) => { asked.push(request); return asked.length === 1 ? '4' : '6'; } },
    };
    const g = graph();
    const trigger = { node_id: 'page', port_id: 'chat_out' };

    await executeGraph(g, { runtime, registry, trigger });
    expect(asked[0].prompt).toBe('User: What is 2+2?');

    const stored = (g.nodes[0].config.gui_widgets as { value: { messages: unknown[]; pending: string } }[])[0];
    expect(stored.value.messages).toEqual([{ role: 'user', text: 'What is 2+2?' }, { role: 'assistant', text: '4' }]);

    stored.value.pending = 'And plus 2?';
    await executeGraph(g, { runtime, registry, trigger });
    expect(asked[1].prompt).toBe('User: What is 2+2?\n\nAssistant: 4\n\nUser: And plus 2?');
  });
});
