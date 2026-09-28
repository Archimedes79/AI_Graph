import { describe, it, expect } from 'vitest';
import { batchItems, mergeBatchOutputs, reconcileOutputs } from './batching.ts';
import type { GraphNode, Port } from '../graph.ts';

function port(id: string, kind: 'input' | 'output', multi: boolean): Port {
  return { id, name: id, kind, data_type: 'any', multi, required: false, description: '' };
}

function node(inputs: Port[] = [], outputs: Port[] = []): GraphNode {
  return {
    id: 'n', node_type: 'code', label: 'n', description: '',
    position: { x: 0, y: 0 }, inputs, outputs, config: {},
  };
}

describe('batchItems', () => {
  it('fans out over declared-multi ports, not over anything that looks like a list', () => {
    // A list arriving on a single-valued port is one value that happens to be a
    // list -- a node taking a list as one argument must not run once per element.
    const n = node([port('many', 'input', true), port('one', 'input', false)]);
    expect(batchItems(n, { many: ['a', 'b'], one: [1, 2, 3] })).toEqual({
      items: [{ many: 'a', one: [1, 2, 3] }, { many: 'b', one: [1, 2, 3] }],
      fanned: true,
    });
  });

  it('makes an empty list zero runs, not one run with an empty list', () => {
    // A folder with no files should produce no results, and a body that has
    // never seen an empty batch should not be handed one.
    const n = node([port('files', 'input', true)]);
    expect(batchItems(n, { files: [] })).toEqual({ items: [], fanned: true });
  });

  it('runs once when nothing is being fanned out, and says so', () => {
    expect(batchItems(node([port('one', 'input', false)]), { one: 'x' })).toEqual({ items: [{ one: 'x' }], fanned: false });
    // A list input handed one value that is not a list: nothing to run over either.
    expect(batchItems(node([port('many', 'input', true)]), { many: 'x' })).toEqual({ items: [{ many: 'x' }], fanned: false });
  });

  it('pads a short list with null so items stay aligned with their inputs', () => {
    const n = node([port('a', 'input', true), port('b', 'input', true)]);
    expect(batchItems(n, { a: [1, 2, 3], b: [9] }).items).toEqual([
      { a: 1, b: 9 }, { a: 2, b: null }, { a: 3, b: null },
    ]);
  });
});

describe('mergeBatchOutputs', () => {
  it('keeps what one call on everything returned, where there was no list to run over', () => {
    // Otherwise per-item and whole-list disagree wherever there was nothing to
    // fan out, which is the case nobody tests until it breaks.
    const n = node([], [port('out', 'output', false)]);
    expect(mergeBatchOutputs(n, [{ out: 42 }], false)).toEqual({ out: 42 });
  });

  it('collects the items of a list into a list, however many there were', () => {
    // One item used to be handed on bare and two as a list: the node after it
    // was handed a text or a list depending on how many files were in a folder.
    const n = node([], [port('out', 'output', false)]);
    expect(mergeBatchOutputs(n, [{ out: 1 }, { out: 2 }], true)).toEqual({ out: [1, 2] });
    expect(mergeBatchOutputs(n, [{ out: 1 }], true)).toEqual({ out: [1] });
  });

  it('hands on a list of none on every output but the error port, for a list of none', () => {
    const n = node([], [port('out', 'output', false), port('many', 'output', true), port('error', 'output', false)]);
    expect(mergeBatchOutputs(n, [], true)).toEqual({ out: [], many: [] });
  });

  it('flattens a port that was declared multi', () => {
    const n = node([], [port('out', 'output', true)]);
    expect(mergeBatchOutputs(n, [{ out: [1, 2] }, { out: [3] }], true)).toEqual({ out: [1, 2, 3] });
  });
});

describe('reconcileOutputs', () => {
  it('wraps a body that returned its whole answer, when there is one port to put it on', () => {
    const n = node([], [port('output', 'output', false)]);
    expect(reconcileOutputs(n, { count: 3 })).toEqual({ output: { count: 3 } });
  });

  it('wraps it as well beside the error port a node grows to catch its failures', () => {
    // Ticking "catch failures" adds `error` to the outputs; the answer still
    // has one port to go on, and used to reach nothing downstream instead.
    const n = node([], [port('output', 'output', false), port('error', 'output', false)]);
    expect(reconcileOutputs(n, { n: 3 })).toEqual({ output: { n: 3 } });
    expect(reconcileOutputs(n, { error: 'said so' })).toEqual({ error: 'said so' });
  });

  it('leaves a body that named its ports alone', () => {
    const n = node([], [port('a', 'output', false), port('b', 'output', false)]);
    expect(reconcileOutputs(n, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('does not guess when there are several ports and none matched', () => {
    // There is no honest guess here, so the value passes through and the
    // mismatch shows up downstream where it can be seen.
    const n = node([], [port('a', 'output', false), port('b', 'output', false)]);
    expect(reconcileOutputs(n, { other: 1 })).toEqual({ other: 1 });
  });
});
