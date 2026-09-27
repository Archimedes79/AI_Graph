import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { parseExamples } from '@engine/execution/examples.ts';
import { formatInstruction } from '@engine/elements/nodes/ai/prompt.ts';
import { AiNodeRunner } from '@engine/elements/nodes/ai/AiNodeRunner.ts';
import { exampleFor, keptAnswer, keptExpect, listPorts, runsPerItem, tryInputs, withPerItem } from './nodeStepRules';
import { readPair, withExpect, withInput } from './examplePair';

describe('"Keep this result"', () => {
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

  it('keeps what a code node gave as its example\'s expected output, which `test` then holds it to', () => {
    // Step 5 promised to keep a result as an example, and nothing could.
    const tried = withInput('', '{"input": ["a", "b"]}');
    const kept = withExpect(tried, keptExpect({ output: ['A', 'B'], error: null }));
    expect(readPair(kept).expect).toEqual({ output: ['A', 'B'] });
    expect(parseExamples(kept).examples).toEqual([{ title: 'The example', inputs: { input: ['a', 'b'] }, expect: { output: ['A', 'B'] } }]);
  });
});

describe('"Run once per item"', () => {
  it('sets how the node runs and which inputs fan out together, since neither does anything alone', () => {
    const node = NODE_KINDS.code.create('worker');
    node.inputs.push({ ...node.inputs[0], id: 'words', name: 'words', multi: false });

    const whole = withPerItem(node, false);
    expect(whole.config.batch_mode).toBe('whole_list');
    expect(whole.inputs.map((port) => port.multi)).toEqual([false, false]);
    expect(runsPerItem(whole)).toBe(false);

    const perItem = withPerItem(whole, true, ['input']);
    expect(perItem.config.batch_mode).toBe('per_item');
    expect(perItem.inputs.map((port) => port.multi)).toEqual([true, false]);
    expect(runsPerItem(perItem)).toBe(true);
  });

  it('hands an input typed List its list whole, even to a node run per item', () => {
    // The "list" box on each input also said which list is taken whole beside
    // one run per item -- a stop-word list beside the words. The port's type
    // says it now.
    const node = NODE_KINDS.code.create('worker');
    node.inputs.push({ ...node.inputs[0], id: 'stop', name: 'stop', data_type: 'list', multi: false });
    const example = { input: ['alpha', 'beta'], stop: ['a', 'the'] };
    expect(listPorts(node, example)).toEqual(['input']);
    expect(withPerItem(node, true, listPorts(node, example)).inputs.map((port) => port.multi)).toEqual([true, false]);
    expect(withPerItem(node, true).inputs.map((port) => port.multi)).toEqual([true, false]);
  });

  it('is asked when a list arrives: in the example, by a declared list, or down a wire from one', () => {
    const node = withPerItem(NODE_KINDS.code.create('worker'), false);
    node.inputs.push({ ...node.inputs[0], id: 'words', name: 'words' });
    expect(listPorts(node, { input: 'one', words: 'two' })).toEqual([]);
    expect(listPorts(node, { input: ['one'], words: 'two' })).toEqual(['input']);

    const source = NODE_KINDS.code.create('source');
    expect(listPorts(node, undefined, [source, node], [
      { source: 'source', sourceHandle: 'output', target: 'worker', targetHandle: 'words' },
    ])).toEqual(['words']);
  });
});

describe('▶ Try it', () => {
  it('runs on step 1\'s example, and waits for one', () => {
    const node = NODE_KINDS.code.create('worker');
    expect(tryInputs(node, undefined)).toBeUndefined();
    expect(tryInputs(node, { input: 'x' })).toEqual({ input: 'x' });
  });

  it('runs a node with no inputs on nothing, where no example can be filled', () => {
    // It said "Fill step 1's example first: ⟳ from the graph, or 📂 from a
    // file" -- neither of which a node without inputs offers.
    const node = NODE_KINDS.code.create('maker');
    node.inputs = [];
    expect(tryInputs(node, undefined)).toEqual({});
  });
});

describe('a check written in step 2', () => {
  it('is written against an input of {} for a node that takes nothing in, and waits for step 1 otherwise', () => {
    // A node with no inputs has no box to type its example into: it is run on nothing.
    const maker = NODE_KINDS.code.create('maker');
    maker.inputs = [];
    const made = withExpect(exampleFor(maker, ''), '{"output": 1}');
    expect(parseExamples(made).examples).toEqual([{ title: 'The example', inputs: {}, expect: { output: 1 } }]);

    const worker = NODE_KINDS.code.create('worker');
    expect(exampleFor(worker, '')).toBe('');
    expect(parseExamples(withExpect(exampleFor(worker, ''), '{"output": 1}')).examples).toEqual([]);
  });
});
