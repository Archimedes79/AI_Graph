import { describe, it, expect } from 'vitest';
import { lastAsked } from './lastAsked';

describe('✨ AI Graph\'s Cancel', () => {
  it('leaves the design on its way unwanted, and a new one wanted (B36)', () => {
    // Cancel closed the dialog and let the request run on: opened again, the
    // dialog offered the old design as the answer to a new, empty description.
    const asked = lastAsked();
    const first = asked.ask();
    expect(first()).toBe(true);
    asked.cancel();
    expect(first()).toBe(false);
    const second = asked.ask();
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });
});
