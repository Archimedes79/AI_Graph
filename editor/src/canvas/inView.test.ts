import { describe, expect, it } from 'vitest';
import { panToShow, viewDue, type ViewDue } from './inView';

describe('what the view owes the canvas', () => {
  const settled: ViewDue = { document: 1, count: 2, open: null, fit: false, show: null };

  it('fits another graph whole -- New, Open, a level in or out -- and shows nothing of the last', () => {
    expect(viewDue({ ...settled, show: 'a' }, { document: 2, ids: ['x'], open: null })).toEqual({ document: 2, count: 1, open: null, fit: true, show: null });
  });

  it('shows a node added -- from the palette, or the page a block made -- and one whose panel opens', () => {
    expect(viewDue(settled, { document: 1, ids: ['a', 'b', 'c'], open: null }).show).toBe('c');
    expect(viewDue(settled, { document: 1, ids: ['a', 'b'], open: 'a' }).show).toBe('a');
    // Added from the palette, it opens its panel in the same step: the one node either way.
    expect(viewDue(settled, { document: 1, ids: ['a', 'b', 'c'], open: 'c' }).show).toBe('c');
  });

  it('owes nothing for a move, a removal or a panel that stays open', () => {
    expect(viewDue({ ...settled, open: 'a' }, { document: 1, ids: ['a', 'b'], open: 'a' }).show).toBeNull();
    expect(viewDue(settled, { document: 1, ids: ['a'], open: null }).show).toBeNull();
  });
});

// The canvas beside an open panel: 528 by 645 pixels, as at 1024.
const view = { x: 0, y: 0, width: 528, height: 645 };

describe('a node whose panel opens', () => {
  it('is left where it is when it is in view', () => {
    expect(panToShow({ x: 100, y: 100, width: 240, height: 90 }, view)).toEqual({ dx: 0, dy: 0 });
  });

  it('is brought in by as little as that takes, when the panel covered it', () => {
    // It stood at 736..976 before the canvas narrowed to 528.
    expect(panToShow({ x: 736, y: 300, width: 240, height: 90 }, view)).toEqual({ dx: 528 - 24 - 976, dy: 0 });
    expect(panToShow({ x: -300, y: -50, width: 240, height: 90 }, view)).toEqual({ dx: 324, dy: 74 });
  });

  it('shows its top left corner when it is bigger than the canvas', () => {
    expect(panToShow({ x: 400, y: 0, width: 900, height: 90 }, view).dx).toBe(24 - 400);
  });
});
