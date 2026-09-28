import { describe, it, expect } from 'vitest';
import type { AICall } from '../host/api.ts';
import { exchangeEntry, withExchange } from './history.ts';

const call = (over: Partial<AICall> = {}): AICall => ({
  provider: 'google', model: 'gemini-flash-lite-latest', system: 'You write code.', prompt: 'Count the words.',
  sent_chars: 31, reply: '```js\nfunction run() {}\n```', reply_chars: 25, seconds: 1.2, error: null, ...over,
});
const AT = new Date(2026, 8, 28, 9, 5);

describe('one exchange', () => {
  it('says when, which, and each call: what was sent and what came back', () => {
    const entry = exchangeEntry('✨ Code', [call()], AT);
    expect(entry.startsWith('## 2026-09-28 09:05 · ✨ Code\n\n### Sent to google gemini-flash-lite-latest')).toBe(true);
    expect(entry).toContain('System:\n\n```\nYou write code.\n```');
    expect(entry).toContain('Prompt:\n\n```\nCount the words.\n```');
    // A reply that holds a fence is fenced by a longer one, so it cannot close it.
    expect(entry).toContain('### Came back after 1.2 s\n\n````\n```js\nfunction run() {}\n```\n````');
  });

  it('numbers the calls of an exchange that made several, and says how one failed', () => {
    const entry = exchangeEntry('✨ Fix', [call(), call({ reply: null, error: 'quota exceeded', seconds: 0.4 })], AT);
    expect(entry).toContain('### Call 1 of 2, sent to google gemini-flash-lite-latest');
    expect(entry).toContain('### Call 2 of 2, sent to');
    expect(entry).toContain('### Failed after 0.4 s\n\n```\nquota exceeded\n```');
  });

  it('keeps a change asked for on its one line', () => {
    expect(exchangeEntry('Change: also\ncount the lines', [call()], AT).split('\n')[0]).toBe('## 2026-09-28 09:05 · Change: also count the lines');
  });
});

describe('the history', () => {
  it('appends the newest last', () => {
    const first = exchangeEntry('✨ Input', [call()], AT);
    const second = exchangeEntry('✨ Output', [call()], AT);
    expect(withExchange('', first)).toBe(first);
    expect(withExchange(`${first}\n`, second)).toBe(`${first}\n\n${second}`);
  });

  it('drops the oldest whole beyond its limit, and never the newest', () => {
    const old = [1, 2, 3].map((n) => exchangeEntry(`✨ Code ${n}`, [call({ prompt: 'x'.repeat(200) })], AT));
    const history = old.reduce((text, entry) => withExchange(text, entry), '');
    const newest = exchangeEntry('✨ Code 4', [call({ prompt: 'y'.repeat(200) })], AT);
    const kept = withExchange(history, newest, old[0].length * 2 + 10);
    expect(kept).not.toContain('✨ Code 1');
    expect(kept).not.toContain('✨ Code 2');
    expect(kept.startsWith('## 2026-09-28 09:05 · ✨ Code 3')).toBe(true);
    expect(kept.endsWith(newest)).toBe(true);
    // Longer than the limit alone, it is still kept.
    expect(withExchange(history, newest, 10)).toBe(newest);
  });
});
