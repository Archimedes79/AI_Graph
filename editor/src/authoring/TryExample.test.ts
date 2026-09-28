import { describe, it, expect } from 'vitest';
import { triedLine, whatCameOf } from './TryExample';

/** What ▶ Try says it came to: ✓ only where the node was held to an output.js that could be read, and fits it. */

describe('what a try came to', () => {
  it('fits, or does not fit, the output.js it was held to -- each output named once', () => {
    expect(triedLine({ status: 'pass', details: [], outputs: { output: 3 }, held: true })).toBe('✓ fits output.js');
    expect(triedLine({ status: 'pass', details: [], outputs: { output: 3 }, held: false })).toBe('It runs. There is no output.js yet to hold it to.');
    expect(triedLine({ status: 'fail', details: ['output "output" is a number; output.js says a list'], outputs: { output: 3 }, held: true }))
      .toBe('✗ Does not fit output.js: output "output" is a number; output.js says a list');
  });

  it('is never "✓ fits" where output.js cannot be read: it says why, and what writes it again', () => {
    const unread = { status: 'fail' as const, details: ['output.js cannot be read: its example after module.exports is not plain JSON'], outputs: { output: 3 }, held: false };
    expect(triedLine(unread)).toBe('✗ output.js cannot be read: its example after module.exports is not plain JSON. ✨ Fix or ✨ Output writes it again.');
    // ✨ Fix is asked with it.
    expect(whatCameOf({ run: unread })).toMatchObject({ problems: unread.details });
  });
});
