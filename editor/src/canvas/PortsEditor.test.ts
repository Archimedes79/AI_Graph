import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Port } from '@/graph';
import { port } from '@engine/elements/port.ts';
import PortsEditor from './PortsEditor';

const needed = (input: Port): Port => ({ ...input, required: true });

describe('the ports editor', () => {
  it('offers "needed" on each input, where step 1 asks "Run once per item" too', () => {
    // The chat example's model is not asked with the history alone because
    // nobody typed a message: its `message` input is needed. Nothing in the
    // editor could say so, so the example could not be built by hand.
    const html = renderToStaticMarkup(createElement(PortsEditor, {
      inputs: [port('history', 'history', 'input', 'text'), needed(port('message', 'message', 'input', 'text'))],
      outputs: [port('output', 'output', 'output', 'text')],
      onChange: () => {},
      inputLists: false,
    }));
    const boxes = html.match(/<input type="checkbox"[^>]*aria-label="input needed"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toContain('checked');
    expect(boxes[1]).toContain('checked');
  });
});
