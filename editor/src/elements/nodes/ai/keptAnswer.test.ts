import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { assemblePrompt } from '@engine/elements/nodes/ai/prompt.ts';
import { AiNodeRunner } from '@engine/elements/nodes/ai/AiNodeRunner.ts';
import { runsPerItem, withPerItem } from '@/authoring/nodeStepRules';
import { keptAnswer, withAnswerShape } from './keptAnswer';

describe('"Keep as expected output", for an ai node', () => {
  it('keeps one answer of an ai node run per item, not the list it hands on', () => {
    // A new ai node runs per item: a try of one prompt hands on a list of one
    // answer. Kept as that list, every later run was told to answer in the
    // shape of a JSON list of a string.
    const node = NODE_KINDS.ai.create('summary');
    expect(runsPerItem(node)).toBe(true);
    expect(keptAnswer(node, { output: ['A short summary.'] })).toBe('A short summary.');
  });

  it('keeps a whole-list ai node\'s answer as it came', () => {
    const node = withPerItem(NODE_KINDS.ai.create('all'), false);
    expect(keptAnswer(node, { output: 'One summary of all.', error: null })).toBe('One summary of all.');
  });

  it('puts the answer into the words, which every request is sent with -- after what they said, over a shape kept before', () => {
    const once = withAnswerShape('Two sentences, no heading.', '{"title": "x"}');
    expect(once).toBe('Two sentences, no heading.\n\nAnswer in this shape: {"title": "x"}');
    expect(withAnswerShape(once, '{"title": "y"}')).toBe('Two sentences, no heading.\n\nAnswer in this shape: {"title": "y"}');
    expect(withAnswerShape('', 'Paris')).toBe('Answer in this shape: Paris');

    const node = NODE_KINDS.ai.create('capital');
    node.config.output_format_prompt = withAnswerShape('', 'Paris');
    const settings = new AiNodeRunner().config(node as never);
    expect(assemblePrompt(settings, { prompt: 'France?' }).system).toContain('Answer in this shape: Paris');
  });
});
