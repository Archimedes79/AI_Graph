import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { parseExamples } from '@engine/execution/examples.ts';
import { exampleFor, keptExpect, listPorts, othersLine, runsPerItem, tryInputs, whatCameOf, wholeList, withPerItem } from './nodeStepRules';
import { readPair, withExpect, withInput } from './examplePair';
import { errorOutput } from '@engine/execution/wiring.ts';

describe('"Keep this result"', () => {
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

  it('makes each output hand on a list per item, and none whole: a list follows it, with no box of its own', () => {
    // The error port "catch failures" adds says why once, whatever the node runs on.
    const node = NODE_KINDS.code.create('worker');
    node.outputs.push(errorOutput('Why it failed.'));
    const multi = (made: typeof node) => made.outputs.map((port) => `${port.id}${port.multi ? ' list' : ''}`);
    expect(multi(withPerItem(node, true))).toEqual(['output list', 'error']);
    expect(multi(withPerItem(node, false))).toEqual(['output', 'error']);
  });

  it('hands an input ticked "whole list" its list whole, even to a node run per item -- and keeps it so', () => {
    // The "list" box on each input also said which list is taken whole beside
    // one run per item -- a stop-word list beside the words. With the box gone,
    // only a type no step sets said it, and taking one whole meant editing
    // interface.json by hand.
    const node = NODE_KINDS.code.create('worker');
    node.inputs.push({ ...node.inputs[0], id: 'stop', name: 'stop', multi: false });
    const example = { input: ['alpha', 'beta'], stop: ['a', 'the'] };
    // Run per item, both lists fan out: the words and the stop words, item by item.
    const perItem = withPerItem(node, true, listPorts(node, example));
    expect(perItem.inputs.map((port) => port.multi)).toEqual([true, true]);
    // "whole list" on the stop words: handed whole to the run of every word.
    const tick = (on: typeof node, whole: boolean) => ({ ...on, inputs: on.inputs.map((port) => (port.id === 'stop' ? wholeList(port, whole) : port)) });
    const whole = tick(perItem, true);
    expect(whole.inputs.map((port) => port.multi)).toEqual([true, false]);
    expect(listPorts(whole, example)).toEqual(['input']);
    // "Run once per item" unticked and ticked again leaves them whole.
    expect(withPerItem(withPerItem(whole, false), true, listPorts(whole, example)).inputs.map((port) => port.multi)).toEqual([true, false]);
    expect(withPerItem(whole, true).inputs.map((port) => port.multi)).toEqual([true, false]);
    // Unticked, they fan out with the words again.
    expect(tick(whole, false).inputs.find((port) => port.id === 'stop')).toMatchObject({ multi: true, data_type: 'any' });
    // An input that reads its files is still read, whole.
    const paths = { ...node.inputs[1], data_type: 'file_path' as const, multi: true };
    expect(wholeList(paths, true)).toMatchObject({ multi: false, data_type: 'file_path' });
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

  it('says what came of the body, for a change asked of it: from the try on screen, else from the last run', () => {
    const ran = { status: 'success', outputs: { output: 'Paris', error: null } };
    expect(whatCameOf({ result: ran }, undefined, undefined)).toEqual({ said: { outcome: 'Paris' }, failed: false });
    // Something to fix: it failed, or falls short of what is expected, or of the judge's sentence.
    expect(whatCameOf({ result: { status: 'error', error: 'boom' } }, undefined, undefined)).toEqual({ said: { error: 'boom' }, failed: true });
    expect(whatCameOf({ result: ran, judged: 'It is not a capital.' }, ['output is "Paris"; expected "Rome"'], undefined)).toEqual({
      said: { outcome: 'Paris', problems: ['output is "Paris"; expected "Rome"', 'judged by a model: It is not a capital.'] }, failed: true,
    });
    // No try: the last run, and the inputs it failed on.
    const run = { node_id: 'n', status: 'error' as const, inputs: { prompt: 'France?' }, outputs: {}, error: 'The model is not answering.' };
    expect(whatCameOf(null, undefined, run)).toEqual({
      said: { error: 'The model is not answering.' }, failed: true, sample: { values: { prompt: 'France?' }, origin: 'the last run' },
    });
    expect(whatCameOf(null, undefined, undefined)).toBeUndefined();
  });

  it('offers ✨ Fix for a failure the node caught and for a run per item that lost items, and sends the error', () => {
    // catch_errors: the executor answers `partial`, null outputs and the message on `error`.
    const message = 'TypeError: inputs.input.split is not a function';
    const caught = { result: { status: 'partial', outputs: { output: null, error: message }, error: message } };
    expect(whatCameOf(caught, undefined, undefined)).toEqual({ said: { outcome: 'null', error: message }, failed: true });
    // Per item: 2 of 5 items failed, and what the rest gave.
    const partly = { result: { status: 'partial', outputs: { output: ['A', null, 'C', null, 'E'] }, error: '2 of 5 items failed: boom' } };
    expect(whatCameOf(partly, undefined, undefined)).toMatchObject({ failed: true, said: { error: '2 of 5 items failed: boom' } });
    // A last run that ended partial is what came of the body too, on the inputs it came of.
    const run = { node_id: 'n', status: 'partial' as const, inputs: { input: 'x' }, outputs: { output: null }, error: 'boom' };
    expect(whatCameOf(null, undefined, run)).toEqual({
      said: { outcome: 'null', error: 'boom' }, failed: true, sample: { values: { input: 'x' }, origin: 'the last run' },
    });
  });

  it('says how the other examples did in one line, which replaced a ▶ Test of its own', () => {
    const passed = { title: 'Two', status: 'pass' as const, details: [] };
    expect(othersLine([])).toBe('');
    expect(othersLine([passed, { ...passed, title: 'Three' }])).toBe('and 2 more: pass');
    expect(othersLine([passed, { title: 'Wrong', status: 'fail', details: ['output.output is 4; expected 5'] }]))
      .toBe('and 2 more: 1 pass, 1 fail -- “Wrong”: output.output is 4; expected 5');
    expect(othersLine([{ title: 'examples.md', status: 'error', details: ['"Broken": no ```json input block.'] }]))
      .toBe('and 1 more: 1 cannot run -- “examples.md”: "Broken": no ```json input block.');
    // One whose judge could not be asked ran: it is not judged, which is not "cannot run".
    expect(othersLine([passed, { title: 'Busy', status: 'error', details: ['The judge could not be asked: 429'], judgeError: '429' }]))
      .toBe('and 2 more: 1 pass, 1 not judged -- “Busy”: The judge could not be asked: 429');
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
