import { describe, it, expect } from 'vitest';
import { parseExamples } from '@engine/execution/examples.ts';
import { examplesFollowPorts, readPair, withExpect, withInput, withJudge } from './examplePair';

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

describe('an example taken away, and one begun from step 2', () => {
  it('takes the example away when its input is emptied, rather than running the node on {}', () => {
    // Emptied, the box stored `{}` next to an empty expectation: `test` ran
    // the node on nothing, and the box showed `{}` again on reopening.
    expect(withInput(withInput('', '{"text": "hello"}'), '')).toBe('');
    expect(withInput(withInput('Notes above.\n', '{"text": "hello"}'), '  ')).toBe('Notes above.\n\n');
    expect(withInput('', '')).toBe('');
  });

  it('keeps what step 2 wrote, and the sections after it byte for byte, when the first input is emptied', () => {
    const emptied = withInput(TWO, '');
    expect(readPair(emptied)).toMatchObject({ title: 'Counts rows', inputText: '', input: undefined, expect: { count: 2 }, complete: false });
    expect(emptied.slice(emptied.indexOf('## Written by hand'))).toBe(TWO.slice(TWO.indexOf('## Written by hand')));
    // `test` runs nothing on it, and `check` says why.
    const { examples, problems } = parseExamples(emptied);
    expect(examples.map((example) => example.title)).toEqual(['Written by hand']);
    expect(problems).toEqual(['"Counts rows": no ```json input block.']);
    // Typed afresh, it is the same example again.
    expect(parseExamples(withInput(emptied, '{"csv": "a\\nb"}')).examples[0]).toEqual({ title: 'Counts rows', inputs: { csv: 'a\nb' }, expect: { count: 2 } });
  });

  it('keeps an emptied first section while others follow, so the next keystroke does not land in one written by hand', () => {
    // A first example that checks only that it runs holds nothing once its input is gone.
    const plain = withExpect(TWO, '');
    expect(readPair(plain).expectText).toBe('{}');
    const emptied = withInput(plain, '');
    expect(readPair(emptied)).toMatchObject({ title: 'Counts rows', inputText: '', others: 1 });
    expect(readPair(withInput(emptied, '{"csv": "x"}'))).toMatchObject({ title: 'Counts rows', input: { csv: 'x' } });
  });

  it('writes a judge or an expectation typed before any input without an input of {}', () => {
    // A judge typed first made an example on nothing, which `test` then judged.
    const judged = withJudge('', 'Says hello.');
    expect(judged).not.toContain('json input');
    expect(readPair(judged)).toMatchObject({ judge: 'Says hello.', inputText: '', complete: false });
    expect(parseExamples(judged).examples).toEqual([]);
    // The input, once typed, completes it.
    expect(parseExamples(withInput(judged, '{"name": "Ada"}')).examples)
      .toEqual([{ title: 'The example', inputs: { name: 'Ada' }, judge: 'Says hello.' }]);
    // Taken away again, nothing is left behind.
    expect(withJudge(judged, '')).toBe('');
    expect(withExpect(withExpect('', '{"out": 1}'), '')).toBe('');
  });
});

describe('the examples, when a port is renamed or removed', () => {
  const FILE = [
    '## One',
    '',
    '```json input',
    '{"input": "a,b", "top": 2}',
    '```',
    '',
    '```json expect',
    '{"output": 2}',
    '```',
    '',
    '## Two',
    '',
    '```json input',
    '{"input": "c", "top": 1}',
    '```',
    '',
    '```judge',
    'Counts.',
    '```',
    '',
  ].join('\n');

  it('renames the key in every section\'s input, and an output\'s in every expectation', () => {
    const moved = examplesFollowPorts(FILE, { inputs: { input: 'csv' }, outputs: { output: 'count' } });
    expect(parseExamples(moved).examples).toEqual([
      { title: 'One', inputs: { csv: 'a,b', top: 2 }, expect: { count: 2 } },
      { title: 'Two', inputs: { csv: 'c', top: 1 }, judge: 'Counts.' },
    ]);
    // Where the key stood, not moved to the end.
    expect(Object.keys(readPair(moved).input!)).toEqual(['csv', 'top']);
  });

  it('drops the key of a port that is gone', () => {
    const moved = examplesFollowPorts(FILE, { inputs: { top: null }, outputs: {} });
    expect(parseExamples(moved).examples.map((example) => example.inputs)).toEqual([{ input: 'a,b' }, { input: 'c' }]);
  });

  it('leaves a key alone when its new name is a key already, and the file alone when nothing is renamed', () => {
    expect(examplesFollowPorts(FILE, { inputs: { input: 'top' }, outputs: {} })).toBe(FILE);
    expect(examplesFollowPorts(FILE, { inputs: { other: 'x' }, outputs: {} })).toBe(FILE);
    expect(examplesFollowPorts('```json input\n{"input": 1}\n```\n', { inputs: { input: 'x' }, outputs: {} }))
      .toBe('```json input\n{"input": 1}\n```\n');
  });
});
