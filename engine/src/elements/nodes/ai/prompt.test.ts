import { describe, it, expect } from 'vitest';
import { assemblePrompt, promptText } from './prompt.ts';

describe('assemblePrompt', () => {
  it('sends what arrived when there are no instructions', () => {
    // A body asking a plain question, and nothing else.
    const { system, user } = assemblePrompt('', { prompt: 'Why is the sky blue?' });
    expect(user).toBe('Why is the sky blue?');
    expect(system).toBe('');
  });

  it('sends one input as it is, and several each under its port id, in the order given', () => {
    expect(assemblePrompt('Be brief.', { text: 'a story' })).toEqual({ system: 'Be brief.', user: 'a story' });
    expect(assemblePrompt('Be brief.', { history: 'User: hi', message: 'And in winter?' }).user)
      .toBe('history:\nUser: hi\n\nmessage:\nAnd in winter?');
  });

  it('leaves out an input that brought nothing, and keeps one that brought an empty text', () => {
    expect(assemblePrompt('', { a: null, b: undefined, c: 'three' }).user).toBe('three');
    expect(assemblePrompt('', { history: '', message: 'hi' }).user).toBe('history:\n\n\nmessage:\nhi');
  });

  it('turns a list into paragraphs, not brackets', () => {
    expect(promptText(['one', 'two'])).toBe('one\n\ntwo');
    expect(promptText([{ a: 1 }])).toBe('{"a":1}');
    expect(assemblePrompt('', { summaries: ['first', 'second'] }).user).toBe('first\n\nsecond');
  });

  it('sends the instructions as the message when nothing arrived', () => {
    expect(assemblePrompt('Write a haiku about autumn.', {})).toEqual({ system: '', user: 'Write a haiku about autumn.' });
  });
});
