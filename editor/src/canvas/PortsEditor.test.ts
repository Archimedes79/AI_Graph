// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Port } from '@/graph';
import { port } from '@engine/elements/port.ts';
import PortsEditor from './PortsEditor';

const needed = (input: Port): Port => ({ ...input, required: true });

describe('the ports editor', () => {
  it('offers "needed" on each input, of a code or an ai node too', () => {
    // The chat example's model is not asked with the history alone because
    // nobody typed a message: its `message` input is needed. Nothing in the
    // editor could say so, so the example could not be built by hand.
    const html = renderToStaticMarkup(createElement(PortsEditor, {
      inputs: [port('history', 'history', 'input', 'text'), needed(port('message', 'message', 'input', 'text'))],
      outputs: [port('output', 'output', 'output', 'text')],
      onChange: () => {},
      compact: true,
    }));
    const boxes = html.match(/<input type="checkbox"[^>]*aria-label="input needed"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toContain('checked');
    expect(boxes[1]).toContain('checked');
  });

  it('asks per input whether to read the file at its path -- ticked where the port is a path to read -- for a kind that reads files', () => {
    // The one way a file is read: there was a node-wide "read file contents"
    // box as well, folded away under Advanced, which did nothing on a port
    // that did not say `file_path`.
    const drawn = (readsFiles: boolean) => renderToStaticMarkup(createElement(PortsEditor, {
      inputs: [port('csv', 'csv', 'input', 'file_path'), port('name', 'name', 'input', 'text')],
      outputs: [], onChange: () => {}, readsFiles,
    }));
    const ticks = drawn(true).match(/<input type="checkbox"[^>]*aria-label="Read the file at this path"[^>]*>/g) ?? [];
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toContain('checked');
    expect(ticks[1]).not.toContain('checked');
    expect(drawn(false)).not.toContain('Read the file at this path');
  });

  it('has no type and no "list" per port for a code or an ai node -- its input.js and output.js say them', () => {
    const drawn = (compact: boolean) => renderToStaticMarkup(createElement(PortsEditor, {
      inputs: [port('csv', 'csv', 'input', 'file_path')], outputs: [port('rows', 'rows', 'output', 'json')], onChange: () => {}, compact,
    }));
    expect(drawn(true)).not.toContain('aria-label="input type"');
    expect(drawn(true)).not.toContain('aria-label="output type"');
    expect(drawn(true)).not.toContain('list</label>');
    // Any other node -- an output node -- still says them per port.
    expect(drawn(false)).toContain('aria-label="input type"');
    expect(drawn(false).match(/list<\/label>/g)).toHaveLength(2);
  });

  it('offers "whole list" on an input while the node runs once per item, beside another that fans out', () => {
    // A stop-word list taken whole beside the words took editing interface.json by hand.
    const words = { ...port('words', 'words', 'input', 'any'), multi: true };
    const stop = port('stop', 'stop', 'input', 'any');
    const drawn = (perItem: boolean, inputs: Port[]) => renderToStaticMarkup(createElement(PortsEditor, {
      inputs, outputs: [], onChange: () => {}, compact: true, perItem,
    }));
    const ticks = drawn(true, [words, stop]).match(/<input type="checkbox"[^>]*aria-label="whole list"[^>]*>/g) ?? [];
    // The stop words are handed whole; the words, the one list left to run over, are not offered it.
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toContain('checked');
    expect(drawn(true, [words, { ...stop, multi: true }]).match(/aria-label="whole list"/g)).toHaveLength(2);
    expect(drawn(false, [words, stop])).not.toContain('whole list');
    expect(drawn(true, [words])).not.toContain('whole list');
  });
});

describe('a port renamed in the ports editor', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  it('takes a name another port had, kept back until then, once that port is gone', async () => {
    // Typed "b" over "a" while there was a "b": said, and kept back. "b" then
    // removed, the row still showed "b" with nothing wrong -- and the port was "a".
    let ports = { inputs: [] as Port[], outputs: [port('a', 'a', 'output', 'any'), port('b', 'b', 'output', 'any')] };
    function Held() {
      const [now, setNow] = useState(ports);
      ports = now;
      return createElement(PortsEditor, {
        inputs: now.inputs, outputs: now.outputs, onChange: setNow,
        editing: { inputs: 'edit', outputs: 'edit' }, hints: {}, wiring: { inputs: {}, outputs: {} },
        readsFiles: false, compact: true, perItem: false, caught: false,
      });
    }
    const screen = document.createElement('div');
    document.body.appendChild(screen);
    const root = createRoot(screen);
    await act(async () => { root.render(createElement(Held)); });

    const field = screen.querySelector<HTMLInputElement>('[aria-label="output name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(field, 'b');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(screen.textContent).toContain('Two outputs are both called "b".');
    expect(ports.outputs.map((one) => one.id)).toEqual(['a', 'b']);

    await act(async () => { screen.querySelector<HTMLButtonElement>('[aria-label="Remove output b"]')!.click(); });
    expect(ports.outputs.map((one) => one.id)).toEqual(['b']);
    expect(screen.querySelector<HTMLInputElement>('[aria-label="output name"]')!.value).toBe('b');
    expect(screen.textContent).not.toContain('both called');

    await act(async () => { root.unmount(); });
    screen.remove();
  });
});
