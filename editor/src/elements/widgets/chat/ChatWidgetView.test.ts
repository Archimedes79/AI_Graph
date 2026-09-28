import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChatWidgetView from './ChatWidgetView';
import { transcript } from '@engine/elements/widgets/chat/ChatWidgetRunner.ts';
import { chatValue } from '@engine/elements/widgets/chat/value.ts';
import { WIDGET_BUILDERS } from '@/elements/registry';

describe('a chat on the page', () => {
  it('draws a turn on the side a run says it on, whatever role an older file stored', () => {
    // The bug: a stored role other than the two was kept by the page and drawn
    // on the assistant's side, while a run sent the same turn as the person's.
    const value = { messages: [{ role: 'system', text: 'hello there' }], pending: '' };
    const widget = WIDGET_BUILDERS.chat.create('chat', 'Chat');
    const html = renderToStaticMarkup(createElement(ChatWidgetView, { widget, value, onChange: () => {} }));
    expect(transcript(chatValue(value).messages)).toBe('User: hello there');
    expect(html).toMatch(/justify-end[^]*hello there/);
    expect(html).not.toContain('justify-start');
  });
});
