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
      stepped: true,
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

  it('has no type and no "list" per port for a node built in the four steps -- a list follows "Run once per item"', () => {
    const drawn = (stepped: boolean) => renderToStaticMarkup(createElement(PortsEditor, {
      inputs: [port('csv', 'csv', 'input', 'file_path')], outputs: [port('rows', 'rows', 'output', 'json')], onChange: () => {}, stepped,
    }));
    expect(drawn(true)).not.toContain('aria-label="input type"');
    expect(drawn(true)).not.toContain('aria-label="output type"');
    expect(drawn(true)).not.toContain('list</label>');
    // A node without the steps -- an output node -- still says them per port.
    expect(drawn(false)).toContain('aria-label="input type"');
    expect(drawn(false).match(/list<\/label>/g)).toHaveLength(2);
  });

  it('offers "whole list" on an input while the node runs once per item, beside another that fans out', () => {
    // A stop-word list taken whole beside the words took editing interface.json by hand.
    const words = { ...port('words', 'words', 'input', 'any'), multi: true };
    const stop = port('stop', 'stop', 'input', 'any');
    const drawn = (perItem: boolean, inputs: Port[]) => renderToStaticMarkup(createElement(PortsEditor, {
      inputs, outputs: [], onChange: () => {}, stepped: true, perItem,
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
