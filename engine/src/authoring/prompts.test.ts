import { describe, it, expect } from 'vitest';
import { STANDARD_PROMPTS, VARIABLES, fillPrompt, nodeDescription, standardRunPrompt, type Variable } from './prompts.ts';

/** The variables *text* names, in the order it names them. */
const named = (text: string): string[] => Object.keys(VARIABLES).filter((name) => text.includes(`{${name}}`));

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

  it('is the heading alone while it says nothing -- and its heading, never its id in its place', () => {
    expect(nodeDescription({ id: 'n1', label: 'Ask', description: '  ', node_type: 'ai' })).toBe('# Ask (ID n1, ai node)');
    // A node without a heading is a problem `check` names, not one this papers over.
    expect(nodeDescription({ id: 'n1', label: ' ', description: 'Asks.', node_type: 'ai' })).not.toMatch(/^# n1/);
  });
});

describe('an ai node\'s standard instructions', () => {
  it('ask for JSON mapped onto its output definition where that names several outputs, or a value that is not text', () => {
    for (const definition of ['module.exports = { "mood": "calm", "reason": "It says so." };', 'module.exports = { "count": 2 };']) {
      const text = standardRunPrompt(definition);
      expect(named(text)).toEqual(['Node Description', 'Output Definition']);
      expect(text).toMatch(/only a JSON object, keyed and shaped as its example after module\.exports -- not the file itself/);
    }
  });

  it('ask for the text itself where it names one output that holds text', () => {
    const text = standardRunPrompt('module.exports = { "summary": "Two sentences." };');
    expect(named(text)).toEqual(['Node Description', 'Output Definition']);
    expect(text).toMatch(/Answer in plain text: the text itself, as this output definition describes it -- not JSON, and not the file\./);
    expect(text).not.toMatch(/JSON object/);
  });

  it('ask for plain text without one', () => {
    expect(standardRunPrompt('')).toBe('{Node Description}\n\nDo this with the input below. Answer in plain text.');
  });
});
