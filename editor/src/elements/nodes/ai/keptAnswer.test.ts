import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NODE_KINDS } from '@/document/nodeKinds';
import { assemblePrompt } from '@engine/elements/nodes/ai/prompt.ts';
import { AiNodeRunner } from '@engine/elements/nodes/ai/AiNodeRunner.ts';
import { runsPerItem, withPerItem } from '@/authoring/nodeStepRules';
import TryItInline from '@/authoring/TryItInline';
import { ONCE } from '../../NodeGuiBuilder';
import { keepAnswerShape, keptAnswer, withAnswerShape } from './keptAnswer';

describe('"Keep this answer\'s shape", for an ai node', () => {
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

  it('is said on its button as what it is: a shape to answer in, not an expected output nothing holds an answer to', () => {
    const node = withPerItem(NODE_KINDS.ai.create('capital'), false);
    const written: unknown[] = [];
    const keep = keepAnswerShape(node, (key, value, step) => written.push([key, typeof value === 'function' ? value('') : value, step]));
    const tried = { result: { status: 'success', outputs: { output: 'Paris' } } };
    const drawn = renderToStaticMarkup(createElement(TryItInline, { canRun: true, busy: false, onTry: () => {}, tried, keep }));
    expect(drawn).toContain('>Keep this answer&#x27;s shape</button>');
    expect(drawn).not.toContain('Keep as expected output');
    // Kept, it is the words' shape, and a step of its own.
    keep.onKeep(tried.result);
    expect(written).toEqual([['output_format_prompt', 'Answer in this shape: Paris', ONCE]]);
  });
});
