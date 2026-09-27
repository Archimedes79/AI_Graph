import { describe, it, expect } from 'vitest';
import type { TextChange } from '@engine/host/api.ts';
import { DiskChanges } from './diskChanges';

const change = (node_id: string): TextChange => ({ node_id, field: 'code', value: `// ${node_id}` });

describe('a change on disk, reported while the editor could not take it', () => {
  it('waits for the next look at the same project, which the server will not report it to again (B36)', () => {
    const disk = new DiskChanges();
    // A look came back after the editor went into a node's graph: not taken.
    disk.arrived('/p', [change('count')]);
    // Back at the top, the next look: the server has nothing new.
    disk.arrived('/p', []);
    expect(disk.due('/p')).toEqual([change('count')]);
    expect(disk.due('/p')).toEqual([]);
  });

  it('is let go once another project is open, which was read from disk as it is', () => {
    const disk = new DiskChanges();
    disk.arrived('/p', [change('count')]);
    expect(disk.due('/q')).toEqual([]);
    disk.arrived('/q', [change('sum')]);
    expect(disk.due('/q')).toEqual([change('sum')]);
    expect(disk.due('/p')).toEqual([]);
  });
});
