import { describe, it, expect } from 'vitest';
import { inferInterface, schemaOutline } from '@engine/execution/interface.ts';
import { outline } from './OutputInterface';

describe('the shape a run kept, in one line', () => {
  it('says each port as the engine says it to ✨ and the nodes after it (B36)', () => {
    // A list of numbers and texts, whole numbers, and rows: what a run keeps.
    const kept = inferInterface({
      output: [1, 'two'],
      count: 3,
      rows: [{ name: 'a', size: 1.5 }],
    });
    expect(outline(kept)).toBe([
      `output: ${schemaOutline(kept.properties!.output)}`,
      `count: ${schemaOutline(kept.properties!.count)}`,
      `rows: ${schemaOutline(kept.properties!.rows)}`,
    ].join(' · '));
  });
});
