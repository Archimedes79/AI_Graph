import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SidePanel, { panelHearsEscape } from './SidePanel';

/** A page with a dialog or a menu open on it, or neither. */
const page = (open: 'dialog' | 'menu' | null) => ({
  querySelector: (selector: string) => (open && selector.includes(`[role="${open}"]`) ? ({} as Element) : null),
});
const onScreen = { offsetParent: {} as Element };

describe('Escape and the panel beside the canvas', () => {
  it('closes it while it is on screen and nothing else is open', () => {
    expect(panelHearsEscape(onScreen, page(null))).toBe(true);
  });

  it('is heard first by a dialog or a menu open over it -- a file browser opened from the panel, the File menu', () => {
    expect(panelHearsEscape(onScreen, page('dialog'))).toBe(false);
    expect(panelHearsEscape(onScreen, page('menu'))).toBe(false);
  });

  it('is left to a file box it is pressed in: it closed the panel from under what was being typed', () => {
    const inside = (selector: string) => (selector === '.cm-editor' ? ({} as Element) : null);
    expect(panelHearsEscape(onScreen, page(null), { closest: inside } as unknown as EventTarget)).toBe(false);
    expect(panelHearsEscape(onScreen, page(null), { closest: () => null } as unknown as EventTarget)).toBe(true);
  });

  it('closes nothing while its view is hidden -- the panel is kept for when the graph is back -- or before it is drawn', () => {
    expect(panelHearsEscape({ offsetParent: null }, page(null))).toBe(false);
    expect(panelHearsEscape(null, page(null))).toBe(false);
  });
});

describe('a key pressed in the panel', () => {
  it('is the panel\'s: the canvas beside it is told to pass it over, and the panel takes no focus from it', () => {
    const html = renderToStaticMarkup(createElement(SidePanel, { title: 'Count', onClose: () => {}, children: createElement('button', null, 'Try') }));
    expect(html).toMatch(/^<aside class="nokey /);
    expect(html).not.toContain('tabindex');
    expect(html).toContain('aria-label="Close the panel"');
  });
});
