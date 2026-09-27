import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExecutionResult } from '@/graph';
import RunResult, { resultText } from './RunResult';

const ran = (outputs: Record<string, unknown>): ExecutionResult => ({ status: 'success', node_results: [], outputs });

/**
 * A tool without a page shows what its run hands back. That was a window an
 * output node could be set to open; the output node is the run's result now,
 * under its name, and this is where a delivered tool with no page shows it.
 */
describe('the run\'s result on a tool without a page', () => {
  it('shows each output node\'s values under its name', () => {
    const html = renderToStaticMarkup(createElement(RunResult, {
      result: ran({ Report: { value: { words: 32 } }, Summary: { value: 'Short.' } }),
    }));
    expect(html).toContain('aria-label="The run&#x27;s result"');
    expect(html).toMatch(/<h3[^>]*>Report<\/h3><pre[^>]*>\{\n {2}&quot;words&quot;: 32\n\}<\/pre>/);
    expect(html).toMatch(/<h3[^>]*>Summary<\/h3><pre[^>]*>Short\.<\/pre>/);
  });

  it('shows nothing before a run, or for a run that handed nothing back', () => {
    expect(renderToStaticMarkup(createElement(RunResult, { result: null }))).toBe('');
    expect(renderToStaticMarkup(createElement(RunResult, { result: ran({}) }))).toBe('');
  });

  it('reads a value as it is: text as text, a list a line per item, the rest as JSON', () => {
    expect(resultText({ value: ['one', 'two', null], written_path: '/tmp/out.txt' })).toBe('one\ntwo\n/tmp/out.txt');
    expect(resultText({ value: { a: 1 } })).toBe('{\n  "a": 1\n}');
    expect(resultText('bare')).toBe('bare');
  });
});
