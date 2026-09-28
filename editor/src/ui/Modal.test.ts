import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Modal, { hearsEscape } from './Modal';

/** A page with *dialogs* open on it, in the order they were drawn. */
const page = (...dialogs: Element[]) => ({
  querySelectorAll: (selector: string) => (selector === '[role="dialog"]' ? dialogs : []) as unknown as NodeListOf<Element>,
});

describe('Escape with one dialog over another', () => {
  const under = {} as Element;
  const over = {} as Element;

  it('closes the one on top only -- drawn inside the other or beside it', () => {
    // A file browser opened from a node's dialog, or over the Save dialog
    // whose path box it fills: one Escape closed both.
    expect(hearsEscape(over, page(under, over))).toBe(true);
    expect(hearsEscape(under, page(under, over))).toBe(false);
    expect(hearsEscape(under, page(under))).toBe(true);
  });

  it('closes nothing before the dialog is drawn', () => {
    expect(hearsEscape(null, page(under))).toBe(false);
  });
});

describe('a key pressed in a dialog', () => {
  it('is the dialog\'s: the canvas behind it is told to pass it over -- Backspace on a button deleted the node there', () => {
    // ReactFlow passes over a key in a text field, or under an element marked `nokey`.
    const html = renderToStaticMarkup(createElement(Modal, { title: 'Node', onClose: () => {}, children: createElement('button', null, 'Keep') }));
    expect(html).toMatch(/^<div class="nokey /);
  });
});
