import { describe, it, expect } from 'vitest';
import { STANDARD_PROMPTS, VARIABLES, fillPrompt, nodeDescription, standardRunPrompt, type Variable } from './prompts.ts';

/** The variables *text* names, in the order it names them. */
const named = (text: string): string[] => VARIABLES.filter((name) => text.includes(`{${name}}`));

describe('the standard prompts', () => {
  it('put the description together with what each ✨ is written from', () => {
    expect(named(STANDARD_PROMPTS.input)).toEqual(['Node Description', 'Context', 'Example Files']);
    expect(named(STANDARD_PROMPTS.output)).toEqual(['Node Description', 'Input Definition', 'Context', 'Output Files']);
    expect(named(STANDARD_PROMPTS.code)).toEqual(['Node Description', 'Input Definition', 'Output Definition', 'Context']);
    expect(named(STANDARD_PROMPTS.prompt)).toEqual(['Node Description', 'Input Definition', 'Output Definition', 'Context']);
    expect(named(STANDARD_PROMPTS.data)).toEqual(['Node Description', 'Output Definition', 'Context']);
  });

  it('each end in the task, in words a person can change', () => {
    for (const text of Object.values(STANDARD_PROMPTS)) expect(text).toMatch(/\n\nTask: write [^\n]+$/);
  });
});

describe('a prompt filled', () => {
  const values: Partial<Record<Variable, string>> = { 'Node Description': '# Count (ID count, code node)', Context: 'Graph: Words' };

  it('replaces each variable by its exact name', () => {
    expect(fillPrompt('{Node Description}\n\n{Context}', values)).toBe('# Count (ID count, code node)\n\nGraph: Words');
  });

  it('leaves every other brace as it was written, and a variable nothing fills', () => {
    expect(fillPrompt('Answer with {"count": 1} -- {node description} {Output Definition}', values))
      .toBe('Answer with {"count": 1} -- {node description} {Output Definition}');
  });

  it('puts a value in as it is, "$&" and all', () => {
    expect(fillPrompt('{Context}', { Context: 'costs $& more' })).toBe('costs $& more');
  });
});

describe('a node described', () => {
  it('is its heading, its id and kind, then its text', () => {
    expect(nodeDescription({ id: 'chart', label: 'What to plot', description: 'Reads the CSV.\nLargest first.', node_type: 'code' }))
      .toBe('# What to plot (ID chart, code node)\n\nReads the CSV.\nLargest first.');
  });

  it('is its id where it has no heading, and the heading alone while it says nothing', () => {
    expect(nodeDescription({ id: 'n1', label: ' ', description: '  ', node_type: 'ai' })).toBe('# n1 (ID n1, ai node)');
  });
});

describe('an ai node\'s standard instructions', () => {
  it('ask for JSON mapped onto its output definition while it has one', () => {
    const text = standardRunPrompt(true);
    expect(named(text)).toEqual(['Node Description', 'Output Definition']);
    expect(text).toMatch(/only a JSON object, keyed and shaped as its example after module\.exports -- not the file itself/);
  });

  it('ask for plain text without one', () => {
    expect(standardRunPrompt(false)).toBe('{Node Description}\n\nDo this with the input below. Answer in plain text.');
  });
});
