import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TryItInline, { stillSaid, triedFromExamples } from './TryItInline';
import { readPair, withExpect, withInput, withJudge } from './examplePair';
import { whatCameOf } from './nodeStepRules';

/**
 * ▶ Try it where the example is judged, or where more examples follow: it
 * runs them the way `test` does, and the first is the one the dialog shows.
 */
describe('a try made as `test` runs the examples', () => {
  const first = { title: 'The example', status: 'pass' as const, details: [], outputs: { output: 'Paris' } };
  const other = { title: 'Two', status: 'pass' as const, details: [], outputs: { output: 'Rome' } };
  const example = withInput('', '{"prompt": "France?"}');
  const judgedBy = (sentence: string) => readPair(withJudge(example, sentence));

  it('shows the first example\'s answer, and the rest as the others', () => {
    const tried = triedFromExamples([first, other], readPair(example));
    expect(tried.result).toMatchObject({ status: 'success', outputs: { output: 'Paris' }, error: null });
    expect(tried.others).toEqual([other]);
    expect(tried.judged).toBeUndefined();
  });

  it('carries the judge\'s word on that same answer: nothing said is a pass, a reason is a fail', () => {
    expect(triedFromExamples([first], judgedBy('A capital city.')).judged).toBe('');
    const failed = { ...first, status: 'fail' as const, details: ['judged: It names a country.'] };
    expect(triedFromExamples([failed], judgedBy('A capital city.')).judged).toBe('It names a country.');
  });

  it('is a failure where the example could not run, with no word from a judge', () => {
    const broke = { title: 'The example', status: 'error' as const, details: ['No such file: a.csv'], outputs: {} };
    const tried = triedFromExamples([broke], judgedBy('Anything.'));
    expect(tried.result).toMatchObject({ status: 'error', error: 'No such file: a.csv' });
    expect(tried.judged).toBeUndefined();
  });

  it('says a judge that could not be asked as that -- not as the node failing, and with nothing to fix', () => {
    // runExamples: the node ran and answered Paris; only the call to the judge failed.
    const busy = {
      ...first, status: 'error' as const, details: ['The judge could not be asked: 429 Too Many Requests'], judgeError: '429 Too Many Requests',
    };
    const tried = triedFromExamples([busy], judgedBy('Names a capital city.'));
    expect(tried).toMatchObject({ result: { status: 'success', outputs: { output: 'Paris' }, error: null }, unjudged: '429 Too Many Requests' });
    expect(tried.judged).toBeUndefined();
    expect(whatCameOf(tried, undefined, undefined)).toEqual({ said: { outcome: 'Paris' }, failed: false });
    const drawn = renderToStaticMarkup(createElement(TryItInline, { canRun: true, busy: false, onTry: () => {}, tried }));
    expect(drawn).toContain('Paris');
    expect(drawn).toContain('Not judged: the model that judges could not be asked -- 429 Too Many Requests');
    expect(drawn).not.toContain('It failed');
  });

  it('says a broken output interface beside what came out, as a run says it', () => {
    const broken = { ...first, status: 'fail' as const, details: ['breaks its output interface: output.output is string; the interface says integer'] };
    expect(triedFromExamples([broken], readPair(example)).result?.messages).toEqual(['breaks its output interface: output.output is string; the interface says integer']);
  });
});

describe('what a try says of the examples, once they changed', () => {
  const examples = withJudge(withInput('', '{"prompt": "France?"}'), 'Names a capital city.');
  const answer = { title: 'The example', status: 'pass' as const, details: [], outputs: { output: 'Paris' } };
  // ▶ Try it ran the examples as `test` does, and the judge said "meets it".
  const tried = triedFromExamples([answer], readPair(examples));

  it('drops the judge\'s word once its sentence changed or went: the model never saw the new one', () => {
    const stricter = readPair(withJudge(examples, 'Answers in exactly one word, in German.'));
    expect(stillSaid(tried, stricter)?.judged).toBeUndefined();
    expect(stillSaid(tried, readPair(withJudge(examples, '')))?.judged).toBeUndefined();
    // Under the new sentence the dialog draws no verdict -- and what came out stays.
    const drawn = renderToStaticMarkup(createElement(TryItInline, { canRun: true, busy: false, onTry: () => {}, tried: stillSaid(tried, stricter) }));
    expect(drawn).not.toContain('Judged by a model');
    expect(drawn).toContain('Paris');
    // ✨ Fix and "Say what to change" are not told the old word either.
    const failing = triedFromExamples([{ ...answer, status: 'fail', details: ['judged: It names a country.'] }], readPair(examples));
    expect(whatCameOf(stillSaid(failing, stricter), undefined, undefined)).toEqual({ said: { outcome: 'Paris' }, failed: false });
    // The sentence it judged by, again, is the one it judged.
    expect(stillSaid(tried, readPair(examples))?.judged).toBe('');
  });

  it('drops how the others did once they changed, and keeps it while they are the ones that ran', () => {
    const two = `${examples}\n## Two\n\n\`\`\`json input\n{"prompt": "Italy?"}\n\`\`\`\n\n\`\`\`json expect\n{"output": "Rome"}\n\`\`\`\n`;
    const withOthers = triedFromExamples([answer, { ...answer, title: 'Two', outputs: { output: 'Rome' } }], readPair(two));
    expect(stillSaid(withOthers, readPair(two))?.others).toHaveLength(1);
    const drawn = renderToStaticMarkup(createElement(TryItInline, {
      canRun: true, busy: false, onTry: () => {}, tried: stillSaid(withOthers, readPair(two.replace('"Rome"}', '"Roma"}'))),
    }));
    expect(drawn).not.toContain('and 1 more');
    // The first example's own expectation is not what the others ran: it is checked as it is now.
    expect(stillSaid(withOthers, readPair(withExpect(two, '{"output": "Paris"}')))?.others).toHaveLength(1);
  });
});
