import { describe, expect, it } from 'vitest';
import { hearsEscape } from './Modal';

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
