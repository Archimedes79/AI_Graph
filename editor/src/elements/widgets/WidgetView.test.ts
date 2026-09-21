import { describe, it, expect } from 'vitest';
import { valueToText } from './WidgetView';

describe('what a block shows for a list', () => {
  it('reads names as lines', () => {
    expect(valueToText(['a.txt', 'b.txt'])).toBe('a.txt\nb.txt');
  });

  it('gives paragraphs air: a summary per file is three answers, not one', () => {
    const long = 'The Lighthouse Keeper: a keeper counts ships for thirty-one years, and the ledger outlives the light.';
    expect(valueToText([long, 'Short.'])).toBe(`${long}\n\nShort.`);
  });
});
