import { describe, it, expect } from 'vitest';
import { triedFromExamples } from './TryItInline';

/**
 * ▶ Try it where the example is judged, or where more examples follow: it
 * runs them the way `test` does, and the first is the one the dialog shows.
 */
describe('a try made as `test` runs the examples', () => {
  const first = { title: 'The example', status: 'pass' as const, details: [], outputs: { output: 'Paris' } };
  const other = { title: 'Two', status: 'pass' as const, details: [], outputs: { output: 'Rome' } };

  it('shows the first example\'s answer, and the rest as the others', () => {
    const tried = triedFromExamples([first, other]);
    expect(tried.result).toMatchObject({ status: 'success', outputs: { output: 'Paris' }, error: null });
    expect(tried.others).toEqual([other]);
    expect(tried.judged).toBeUndefined();
  });

  it('carries the judge\'s word on that same answer: nothing said is a pass, a reason is a fail', () => {
    expect(triedFromExamples([first], 'A capital city.').judged).toBe('');
    const failed = { ...first, status: 'fail' as const, details: ['judged: It names a country.'] };
    expect(triedFromExamples([failed], 'A capital city.').judged).toBe('It names a country.');
  });

  it('is a failure where the example could not run, with no word from a judge', () => {
    const broke = { title: 'The example', status: 'error' as const, details: ['No such file: a.csv'], outputs: {} };
    const tried = triedFromExamples([broke], 'Anything.');
    expect(tried.result).toMatchObject({ status: 'error', error: 'No such file: a.csv' });
    expect(tried.judged).toBeUndefined();
  });

  it('says a broken output interface beside what came out, as a run says it', () => {
    const broken = { ...first, status: 'fail' as const, details: ['breaks its output interface: output.output is string; the interface says integer'] };
    expect(triedFromExamples([broken]).result?.messages).toEqual(['breaks its output interface: output.output is string; the interface says integer']);
  });
});
