import { describe, it, expect } from 'vitest';
import { asText } from './text.ts';

/**
 * A value as a box of text reads it: what a text box's port hands on, and --
 * the same function, imported by the page -- what the box shows.
 */
describe('a value, as a box of text reads it', () => {
  it('reads a list of names as lines', () => {
    expect(asText(['a.txt', 'b.txt'])).toBe('a.txt\nb.txt');
  });

  it('gives paragraphs air: a summary per file is three answers, not one', () => {
    const long = 'The Lighthouse Keeper: a keeper counts ships for thirty-one years, and the ledger outlives the light.';
    expect(asText([long, 'Short.'])).toBe(`${long}\n\nShort.`);
  });

  it('writes an object as the JSON it is, and nothing as nothing', () => {
    expect(asText({ answer: 42 })).toBe('{\n  "answer": 42\n}');
    expect(asText(null)).toBe('');
    expect(asText(undefined)).toBe('');
    expect(asText(7)).toBe('7');
  });
});
