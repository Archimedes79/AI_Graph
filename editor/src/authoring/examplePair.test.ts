import { describe, it, expect } from 'vitest';
import { parseExamples } from '@engine/execution/examples.ts';
import { readPair, withExpect, withInput, withJudge } from './examplePair';

/**
 * A node's one example is the first section of its `examples.md`: what the
 * dialog's steps 1 and 2 edit, and what `test` and ✨ read with the engine's
 * own parser.
 */

const TWO = [
  '## Counts rows',
  '',
  '```json input',
  '{"csv": "a\\nb"}',
  '```',
  '',
  '```json expect',
  '{"count": 2}',
  '```',
  '',
  '## Written by hand',
  '',
  '```json input',
  '{"csv": ""}',
  '```',
  '',
  '```judge',
  'Says there is nothing.',
  '```',
  '',
].join('\n');

describe('the example pair', () => {
  it('begins a first section in an empty file, which the engine reads as a runnable example', () => {
    const text = withInput('', '{"csv": "a"}');
    expect(readPair(text)).toMatchObject({ input: { csv: 'a' }, expectText: '{}', complete: true, others: 0 });
    // An input with nothing to check is still checked for running: without
    // the empty expect block, `check` reports the section and `test` skips it.
    expect(parseExamples(text)).toEqual({ examples: [{ title: 'The example', inputs: { csv: 'a' }, expect: {} }], problems: [] });
  });

  it('edits the first section only, and says how many others are kept for `test`', () => {
    const pair = readPair(TWO);
    expect(pair).toMatchObject({ title: 'Counts rows', input: { csv: 'a\nb' }, expect: { count: 2 }, others: 1 });

    const edited = withExpect(withInput(TWO, '{"csv": "a\\nb\\nc"}'), '{"count": 3}');
    const { examples, problems } = parseExamples(edited);
    expect(problems).toEqual([]);
    expect(examples).toEqual([
      { title: 'Counts rows', inputs: { csv: 'a\nb\nc' }, expect: { count: 3 } },
      { title: 'Written by hand', inputs: { csv: '' }, judge: 'Says there is nothing.' },
    ]);
    // What comes after the first section is untouched, byte for byte.
    expect(edited.slice(edited.indexOf('## Written by hand'))).toBe(TWO.slice(TWO.indexOf('## Written by hand')));
  });

  it('keeps JSON that does not parse yet as typed, and says it is not an object', () => {
    const text = withInput(TWO, '{"csv": ');
    const pair = readPair(text);
    expect(pair.inputText).toBe('{"csv":');
    expect(pair.input).toBeUndefined();
    expect(pair.complete).toBe(false);
  });

  it('keeps a judge -- the check for an answer never the same twice -- in the first section, and takes it away again', () => {
    // An ai node's `test` holds its answer to a sentence; the examples.md
    // editor that was the one place to write it is gone, so the pair writes it.
    const tried = withInput('', '{"story": "Once."}');
    const judged = withJudge(tried, 'Two sentences, and no judgement of the story.');
    expect(readPair(judged)).toMatchObject({ judge: 'Two sentences, and no judgement of the story.', expectText: '', complete: true });
    expect(parseExamples(judged)).toEqual({
      examples: [{ title: 'The example', inputs: { story: 'Once.' }, judge: 'Two sentences, and no judgement of the story.' }],
      problems: [],
    });

    const unjudged = withJudge(judged, '  ');
    expect(parseExamples(unjudged)).toEqual({ examples: [{ title: 'The example', inputs: { story: 'Once.' }, expect: {} }], problems: [] });

    // An expectation that names something stays beside the judge; the others stay as they were.
    const both = withJudge(TWO, 'Counts the rows.');
    expect(parseExamples(both).examples).toEqual([
      { title: 'Counts rows', inputs: { csv: 'a\nb' }, expect: { count: 2 }, judge: 'Counts the rows.' },
      { title: 'Written by hand', inputs: { csv: '' }, judge: 'Says there is nothing.' },
    ]);
    expect(withJudge(both, '')).toBe(TWO);
  });

  it('adds an expect block after the input where a section has none', () => {
    const text = withExpect('## Mine\n\n```json input\n{"a": 1}\n```\n', '{"b": 2}');
    expect(parseExamples(text).examples).toEqual([{ title: 'Mine', inputs: { a: 1 }, expect: { b: 2 } }]);
  });
});
