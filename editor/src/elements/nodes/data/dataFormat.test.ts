import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from '@/elements/registry';
import { DataNodeRunner } from '@engine/elements/nodes/data/DataNodeRunner.ts';
import { asEditableText, convertedValue, dataKind, storedValue } from './dataFormat';

const holding = (value: unknown, kind: 'text' | 'structure' = 'text') => {
  const node = NODE_KINDS.data.create('memory');
  node.config.data_format = kind;
  node.config.data_value = value as never;
  return node;
};

describe('what a data node holds, as its box edits it', () => {
  it('edits an object a run left in a Text node as the object, not as a string', () => {
    // One keystroke used to store the box's text: the next run handed the
    // code node a string, `inputs.input.count` was undefined, and a counter
    // silently started again.
    const node = holding({ count: 2 });
    expect(dataKind(node)).toBe('structure');
    const text = asEditableText(node.config.data_value, dataKind(node)).replace('2', '3');
    expect(storedValue(text, dataKind(node))).toEqual({ value: { count: 3 } });
  });

  it('shows a string held as Structure with its quotes, so it can be edited and stays JSON', () => {
    // Shown bare, the next keystroke made it invalid JSON and nothing typed was stored.
    const node = holding('hi', 'structure');
    expect(asEditableText(node.config.data_value, dataKind(node))).toBe('"hi"');
    expect(storedValue('"hi!"', 'structure')).toEqual({ value: 'hi!' });
  });

  it('stores nothing from JSON that does not parse, and says why -- the dialog will not Save over it', () => {
    const result = storedValue('{"count": ', 'structure');
    expect(result).toEqual({ error: expect.stringContaining('valid JSON') });
    // Text is text, whatever it looks like.
    expect(storedValue('{"count": ', 'text')).toEqual({ value: '{"count": ' });
  });

  it('converts what it holds when the Kind is switched, so it hands on what it says it is', () => {
    // Switching used to change only the setting: a JSON string went on being
    // handed on as a string by a node that said it held structure.
    expect(convertedValue('{"a": 1}', 'structure')).toEqual({ a: 1 });
    expect(convertedValue('', 'structure')).toBeNull();
    expect(convertedValue('not json', 'structure')).toBe('not json');
    expect(convertedValue({ a: 1 }, 'text')).toBe('{\n  "a": 1\n}');
    expect(convertedValue(null, 'text')).toBe('');
  });

  it('is shown to the nodes after it as what a run hands on: null from an empty structure', () => {
    const builder = NODE_BUILDERS.data;
    const run = new DataNodeRunner();
    const empty = holding(null, 'structure');
    expect(run.config(empty as never).value).toBeNull();
    expect(builder.restingValue(empty, 'output')).toBeNull();
    // An empty text is nothing to write code against, as before.
    expect(builder.restingValue(holding('', 'text'), 'output')).toBeUndefined();
    expect(builder.restingValue(holding([1, 2], 'structure'), 'output')).toEqual([1, 2]);
  });
});
