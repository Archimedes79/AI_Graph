import { describe, it, expect } from 'vitest';
import { assemblePrompt, formatInstruction, placeholders, promptText, type PromptSettings } from './prompt.ts';

const settings = (over: Partial<PromptSettings> = {}): PromptSettings => ({
  systemPrompt: '', template: '', outputFormat: 'text', outputFormatPrompt: '', outputExample: '', ...over,
});

describe('assemblePrompt', () => {
  it('sends what arrived when nobody wrote anything', () => {
    // The node someone dropped on the canvas and wired up, and nothing else.
    const { system, user } = assemblePrompt(settings(), { prompt: 'Why is the sky blue?' });
    expect(user).toBe('Why is the sky blue?');
    expect(system).toBe('');
  });

  it('joins several inputs by blank lines, in the order given', () => {
    const { user } = assemblePrompt(settings(), { a: 'first', b: 'second' });
    expect(user).toBe('first\n\nsecond');
  });

  it('places a port where the template names it', () => {
    const { user, appended } = assemblePrompt(
      settings({ template: 'Conversation so far:\n{{history}}\n\nNow answer:\n{{message}}' }),
      { message: 'And in winter?', history: 'User: hi\nAssistant: hello' },
    );
    expect(user).toBe('Conversation so far:\nUser: hi\nAssistant: hello\n\nNow answer:\nAnd in winter?');
    expect(appended).toEqual([]);
  });

  it('never drops a wired input the template forgot', () => {
    const { user, appended } = assemblePrompt(
      settings({ template: 'Summarize: {{text}}' }),
      { text: 'a story', extra: 'a second wire' },
    );
    expect(user).toBe('Summarize: a story\n\na second wire');
    expect(appended).toEqual(['extra']);
  });

  it('appends everything to a template with no placeholder at all', () => {
    const { user } = assemblePrompt(settings({ template: 'Summarize this.' }), { text: 'a story' });
    expect(user).toBe('Summarize this.\n\na story');
  });

  it('lets {{input}} stand for every port not named elsewhere', () => {
    const { user, appended } = assemblePrompt(
      settings({ template: 'Question: {{question}}\n\nMaterial:\n{{input}}' }),
      { question: 'who?', a: 'one', b: 'two' },
    );
    expect(user).toBe('Question: who?\n\nMaterial:\none\n\ntwo');
    expect(appended).toEqual([]);
  });

  it('reports a name nothing is wired to, and leaves no braces in the prompt', () => {
    const { user, unknown } = assemblePrompt(settings({ template: 'Hello {{nobody}}!' }), {});
    expect(user).toBe('Hello !');
    expect(unknown).toEqual(['nobody']);
  });

  it('turns a list into paragraphs, not brackets', () => {
    expect(promptText(['one', 'two'])).toBe('one\n\ntwo');
    expect(promptText([{ a: 1 }])).toBe('{"a":1}');
  });

  it('adds the declared format to the instructions', () => {
    expect(assemblePrompt(settings({ systemPrompt: 'Be brief.', outputFormat: 'json' }), {}).system)
      .toBe('Be brief.\n\nRespond with JSON and nothing else.');
  });

  it('can ask for an answer shaped like one it gave before', () => {
    const { system } = assemblePrompt(
      settings({ outputFormat: 'example', outputExample: '{"title": "x", "score": 3}' }), {},
    );
    expect(system).toContain('same format as this example');
    expect(system).toContain('{"title": "x", "score": 3}');
  });

  it('falls back to plain text when the example was never recorded', () => {
    expect(assemblePrompt(settings({ outputFormat: 'example' }), {}).system).toBe('');
  });

  it('lists placeholders once each, in order', () => {
    expect(placeholders('{{b}} {{ a }} {{b}}')).toEqual(['b', 'a']);
  });
});

describe('formatInstruction', () => {
  it('sends the description of the answer (output.md) whatever format is picked', () => {
    expect(formatInstruction(settings({ outputFormatPrompt: 'One sentence.' }))).toBe('One sentence.');
    expect(formatInstruction(settings({ outputFormat: 'custom', outputFormatPrompt: 'One sentence.' }))).toBe('One sentence.');
    expect(formatInstruction(settings({ outputFormat: 'json', outputFormatPrompt: 'Keys: name, count.' })))
      .toBe('Respond with JSON and nothing else.\n\nKeys: name, count.');
  });

  it('says nothing for plain text with no description', () => {
    expect(formatInstruction(settings())).toBe('');
    expect(formatInstruction(settings({ outputFormatPrompt: '   ' }))).toBe('');
  });
});
