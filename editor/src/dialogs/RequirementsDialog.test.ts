import { describe, expect, it } from 'vitest';
import { browsesFor } from './RequirementsDialog';

describe('Before running…', () => {
  it('browses for a file an output writes as one to save, which may not exist yet', () => {
    // It opened a browser that picks existing files only, so a new file's
    // name could only be typed.
    expect(browsesFor({ kind: 'file', direction: 'output' })).toBe('save');
    expect(browsesFor({ kind: 'file', direction: 'input' })).toBe('file');
    expect(browsesFor({ kind: 'directory', direction: 'output' })).toBe('directory');
    expect(browsesFor({ kind: 'directory', direction: 'input' })).toBe('directory');
  });
});
