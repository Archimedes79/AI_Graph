import { describe, expect, it } from 'vitest';
import { panToShow } from './inView';

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
