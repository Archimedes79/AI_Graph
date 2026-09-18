import { describe, it, expect, beforeEach } from 'vitest';
import { sampleFor, tryValues, typedValue, useTryValues } from './tryValues';

beforeEach(() => useTryValues.setState({ typed: {}, fetched: {} }));

describe('the values an element is tried on', () => {
  it('prefers what was typed, then what the graph delivered, then the last run', () => {
    useTryValues.getState().setFetched('n', { a: 'from graph', b: 'from graph' });
    useTryValues.getState().setTyped('n', 'a', 'typed');
    const { values, source } = tryValues('n', ['a', 'b', 'c', 'd'], { b: 'old', c: 'last' });
    expect(values).toEqual({ a: 'typed', b: 'from graph', c: 'last' });
    expect(source).toEqual({ a: 'typed', b: 'graph', c: 'last run' });
  });

  it('asking the graph again replaces what was typed: "the real thing, please"', () => {
    useTryValues.getState().setTyped('n', 'a', 'typed');
    useTryValues.getState().setFetched('n', { a: 'real' });
    expect(tryValues('n', ['a'], {}).values).toEqual({ a: 'real' });
  });

  it('reads a list or an object typed as JSON, and leaves everything else the text it is', () => {
    expect(typedValue('[{"t": "08:00", "temp": 61}]')).toEqual([{ t: '08:00', temp: 61 }]);
    expect(typedValue('{"a": 1}')).toEqual({ a: 1 });
    expect(typedValue('17')).toBe('17');
    expect(typedValue('[not json')).toBe('[not json');
    expect(typedValue('Once upon a time')).toBe('Once upon a time');
  });

  it('is the sample a generation is verified against -- and none when it holds nothing', () => {
    expect(sampleFor('n', ['a'], undefined)).toBeUndefined();
    useTryValues.getState().setTyped('n', 'a', '[1, 2]');
    expect(sampleFor('n', ['a'], undefined)).toEqual({ a: [1, 2] });
  });

  it('keeps one element\'s values apart from another\'s, a block\'s from its node\'s', () => {
    useTryValues.getState().setTyped('page::chart', 'value', 'x');
    expect(tryValues('page', ['value'], {}).values).toEqual({});
  });
});
