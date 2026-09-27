import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { formatInstruction } from '@engine/elements/nodes/ai/prompt.ts';
import { AiNodeRunner } from '@engine/elements/nodes/ai/AiNodeRunner.ts';
import { runsPerItem, withPerItem } from '@/authoring/nodeStepRules';
import { keptAnswer } from './keptAnswer';

describe('"Keep this result", for an ai node', () => {
  it('keeps one answer of an ai node run per item as the answer to imitate, not the list it hands on', () => {
    // A new ai node runs per item: a try of one prompt hands on a list of one
    // answer. Kept as that list, every later run was told to answer "in
    // exactly the same format as this example" -- a JSON list of a string.
    const node = NODE_KINDS.ai.create('summary');
    expect(runsPerItem(node)).toBe(true);
    const kept = keptAnswer(node, { output: ['A short summary.'] });
    expect(kept).toBe('A short summary.');

    const settings = new AiNodeRunner().config({ ...node, config: { ...node.config, output_example: kept } } as never);
    expect(formatInstruction(settings)).not.toContain('[');
  });

  it('keeps a whole-list ai node\'s answer as it came', () => {
    const node = withPerItem(NODE_KINDS.ai.create('all'), false);
    expect(keptAnswer(node, { output: 'One summary of all.', error: null })).toBe('One summary of all.');
  });
});
