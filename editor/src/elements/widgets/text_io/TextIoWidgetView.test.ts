import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WIDGET_BUILDERS } from '@/elements/registry';
import TextIoWidgetView from './TextIoWidgetView';

const box = (mode: string, value: unknown, incoming?: unknown) => renderToStaticMarkup(createElement(TextIoWidgetView, {
  widget: WIDGET_BUILDERS.text_io.create('answer', 'Answer', mode), value, incoming, onChange: () => {},
}));
const SAVE = 'Save this text as a file';

describe('a text box on the page', () => {
  it('offers to save the text a run put in it, once there is some', () => {
    expect(box('output', 'The summary.')).toContain(SAVE);
    expect(box('output', '')).not.toContain(SAVE);
    expect(box('both', '', 'The reply.')).toContain(SAVE);
    expect(box('both', 'Being typed')).not.toContain(SAVE);
  });

  it('offers nothing to save of what is typed into it: that is the person\'s already', () => {
    expect(box('input', 'Typed')).not.toContain(SAVE);
  });
});
