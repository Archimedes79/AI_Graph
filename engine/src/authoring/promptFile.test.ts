import { describe, it, expect } from 'vitest';
import { PROMPT_VARIABLES, STANDARD_PROMPT, fillPrompt, requestOf, withRequest } from './promptFile.ts';

const filled = { 'Input Needs': '- `text`', 'Output Example': '- `count`', Graph: 'Not given.' };

describe('the standard prompt', () => {
  it('names each variable once, and ends in the line the request follows', () => {
    for (const name of PROMPT_VARIABLES) expect(STANDARD_PROMPT.split(`{${name}}`)).toHaveLength(2);
    expect(STANDARD_PROMPT.endsWith('\nPrompt:\n')).toBe(true);
    expect(requestOf(STANDARD_PROMPT)).toBe('');
  });
});

describe('the request in a prompt', () => {
  it('is what follows the last Prompt: line', () => {
    expect(requestOf(`${STANDARD_PROMPT}Count the words.`)).toBe('Count the words.');
    // A request that quotes the marker itself keeps it: only the last one counts.
    expect(requestOf('Prompt:\nfirst\nPrompt:\nsecond')).toBe('second');
    expect(requestOf('Intro\n  Prompt:  \r\nCount.')).toBe('Count.');
  });

  it('is the whole text when there is no Prompt: line -- a bare request', () => {
    expect(requestOf('Count the words.')).toBe('Count the words.');
    expect(requestOf('Answer with "Prompt: yes" or "no".')).toBe('Answer with "Prompt: yes" or "no".');
    expect(requestOf('')).toBe('');
  });

  it('is kept as typed, a line break at its end too', () => {
    expect(requestOf(`${STANDARD_PROMPT}One\ntwo\n`)).toBe('One\ntwo\n');
  });
});

describe('a prompt with another request', () => {
  it('keeps the template and replaces what follows Prompt:', () => {
    const mine = 'Input:\n{Input Needs}\n\nBe careful.\n\nPrompt:\nCount.';
    expect(withRequest(mine, 'Count twice.')).toBe('Input:\n{Input Needs}\n\nBe careful.\n\nPrompt:\nCount twice.');
    expect(withRequest('Intro\nPrompt:', 'Count.')).toBe('Intro\nPrompt:\nCount.');
  });

  it('is the standard template for an empty text, and the request alone for a bare one', () => {
    expect(withRequest('', 'Count.')).toBe(`${STANDARD_PROMPT}Count.`);
    expect(withRequest('  \n', 'Count.')).toBe(`${STANDARD_PROMPT}Count.`);
    expect(withRequest('Count the words.', 'Count the lines.')).toBe('Count the lines.');
  });

  it('reads back what was put in, whatever was typed', () => {
    for (const request of ['', 'One', 'One\n', '\nTwo lines\nhere']) {
      expect(requestOf(withRequest(`${STANDARD_PROMPT}old`, request))).toBe(request);
      expect(requestOf(withRequest('', request))).toBe(request);
    }
  });
});

describe('a prompt as it is sent', () => {
  it('fills each variable by its exact name, and leaves every other brace alone', () => {
    const text = 'Input:\n{Input Needs}\n\nAnswer as {"count": 1} -- {Graph} and { Graph }.\n\nPrompt:\nCount.';
    expect(fillPrompt(text, filled)).toBe('Input:\n- `text`\n\nAnswer as {"count": 1} -- Not given. and { Graph }.\n\nPrompt:\nCount.');
  });

  it('sends a bare request in the standard template', () => {
    expect(fillPrompt('Count the words.', filled)).toBe(
      'Input:\n- `text`\n\nOutput Example:\n- `count`\n\nGraph Context:\nNot given.\n\nPrompt:\nCount the words.',
    );
    expect(fillPrompt('', filled)).toBe(fillPrompt(STANDARD_PROMPT, filled));
  });

  it('takes a template without the Prompt: line as the person wrote it', () => {
    expect(fillPrompt('Write for {Graph}', filled)).toBe('Write for Not given.');
  });

  it('puts a value in as it is, "$&" and all', () => {
    expect(fillPrompt('{Graph}', { ...filled, Graph: 'costs $& more' })).toBe('costs $& more');
  });
});
