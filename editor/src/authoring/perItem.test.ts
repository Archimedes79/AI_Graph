import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { listPorts, runsPerItem, wholeList, withPerItem } from './perItem';
import { errorOutput } from '@engine/execution/wiring.ts';

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

  it('is what the engine does: a kind that takes what arrives whole runs so, whatever its setting says', () => {
    // An output node that fanned out wrote each item over the same file, so
    // the engine never runs one per item; the editor said it did.
    const output = NODE_KINDS.output.create('out');
    const told = { ...output, config: { ...output.config, batch_mode: 'per_item' as const }, inputs: output.inputs.map((port) => ({ ...port, multi: true })) };
    expect(runsPerItem(told)).toBe(false);
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

    // A node run once per item hands on the list of what its runs gave.
    const source = withPerItem(NODE_KINDS.code.create('source'), true);
    expect(listPorts(node, undefined, [source, node], [
      { source: 'source', sourceHandle: 'output', target: 'worker', targetHandle: 'words' },
    ])).toEqual(['words']);
  });

  it('is not ticked on a new code or ai node: it runs once, on what arrives whole', () => {
    // Made per item, a node split what it was handed: a chart block got a
    // one-item list, and a sort sorted one item per call.
    for (const kind of ['code', 'ai'] as const) {
      const node = NODE_KINDS[kind].create('made');
      expect(withPerItem(node, false)).toEqual(node);
      expect(runsPerItem(node)).toBe(false);
      expect(listPorts(node, undefined)).toEqual([]);
    }
  });
});
