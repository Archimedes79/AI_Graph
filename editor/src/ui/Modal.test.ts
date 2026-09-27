import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Modal, { hearsEscape } from './Modal';

/** A dialog's panel, holding another dialog open inside it or not. */
const panel = (holdsDialog: boolean) => ({
  querySelector: (selector: string) => (holdsDialog && selector === '[role="dialog"]' ? ({} as Element) : null),
});

describe('Escape in a dialog inside a dialog', () => {
  it('closes the inner one only', () => {
    // A file browser opened from a node's dialog: Escape closed both.
    expect(hearsEscape(panel(true))).toBe(false);
    expect(hearsEscape(panel(false))).toBe(true);
  });

  it('closes nothing before the dialog is drawn', () => {
    expect(hearsEscape(null)).toBe(false);
  });
});

describe('a key pressed in a dialog', () => {
  it('is the dialog\'s: the canvas behind it is told to pass it over -- Backspace on a button deleted the node there', () => {
    // ReactFlow passes over a key in a text field, or under an element marked `nokey`.
    const html = renderToStaticMarkup(createElement(Modal, { title: 'Node', onClose: () => {}, children: createElement('button', null, 'Keep') }));
    expect(html).toMatch(/^<div class="nokey /);
  });
});
