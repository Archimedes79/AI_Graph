import { describe, it, expect } from 'vitest';
import { batchItems, mergeBatchOutputs, reconcileOutputs } from './batching.ts';
import type { GraphNode, Port } from './graph.ts';

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
    const items = batchItems(n, { many: ['a', 'b'], one: [1, 2, 3] });
    expect(items).toEqual([
      { many: 'a', one: [1, 2, 3] },
      { many: 'b', one: [1, 2, 3] },
    ]);
  });

  it('makes an empty list zero runs, not one run with an empty list', () => {
    // A folder with no files should produce no results, and a body that has
    // never seen an empty batch should not be handed one.
    const n = node([port('files', 'input', true)]);
    expect(batchItems(n, { files: [] })).toEqual([]);
  });

  it('runs once when nothing is being fanned out', () => {
    const n = node([port('one', 'input', false)]);
    expect(batchItems(n, { one: 'x' })).toEqual([{ one: 'x' }]);
  });

  it('pads a short list with null so items stay aligned with their inputs', () => {
    const n = node([port('a', 'input', true), port('b', 'input', true)]);
    expect(batchItems(n, { a: [1, 2, 3], b: [9] })).toEqual([
      { a: 1, b: 9 }, { a: 2, b: null }, { a: 3, b: null },
    ]);
  });
});

describe('mergeBatchOutputs', () => {
  it('keeps a single item scalar, because one item is not a fan-out', () => {
    // Otherwise per-item and whole-list disagree wherever there was nothing to
    // fan out, which is the case nobody tests until it breaks.
    const n = node([], [port('out', 'output', false)]);
    expect(mergeBatchOutputs(n, [{ out: 42 }])).toEqual({ out: 42 });
  });

  it('collects several items into a list', () => {
    const n = node([], [port('out', 'output', false)]);
    expect(mergeBatchOutputs(n, [{ out: 1 }, { out: 2 }])).toEqual({ out: [1, 2] });
  });

  it('flattens a port that was declared multi', () => {
    const n = node([], [port('out', 'output', true)]);
    expect(mergeBatchOutputs(n, [{ out: [1, 2] }, { out: [3] }])).toEqual({ out: [1, 2, 3] });
  });
});

describe('reconcileOutputs', () => {
  it('wraps a body that returned its whole answer, when there is one port to put it on', () => {
    const n = node([], [port('output', 'output', false)]);
    expect(reconcileOutputs(n, { count: 3 })).toEqual({ output: { count: 3 } });
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
