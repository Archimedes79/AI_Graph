import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from '@/document/nodeKinds';
import { NODE_BUILDERS } from './registry';

describe('what a saved node publishes as its description', () => {
  it('is a code node\'s task: a description nobody could see or edit went on being published beside it', () => {
    // interface.json's "about" and flow.js said "Reads the chosen file and
    // says what it is" while the task said something else entirely.
    const node = NODE_KINDS.code.create('reader');
    node.description = 'Reads the chosen file and says what it is';
    node.config.prompt = 'Pass the file\'s text on, and describe the file in one line.';
    expect(NODE_BUILDERS.code.publishedDescription(node)).toBe('Pass the file\'s text on, and describe the file in one line.');
  });

  it('is a data node\'s own description: what it holds is its value, and nothing else asks what it should hold', () => {
    const node = NODE_KINDS.data.create('memory');
    node.description = 'The running total, a number.';
    expect(NODE_BUILDERS.data.publishedDescription(node)).toBe('The running total, a number.');
    expect(NODE_BUILDERS.data.ownsDescription).toBeFalsy();
  });

  it('keeps what was there while no task is written, and leaves an ai node\'s -- its task -- alone', () => {
    const node = NODE_KINDS.code.create('reader');
    node.description = 'Written before';
    expect(NODE_BUILDERS.code.publishedDescription(node)).toBe('Written before');
    const ai = NODE_KINDS.ai.create('ask');
    ai.description = 'Summarise it.';
    expect(NODE_BUILDERS.ai.publishedDescription(ai)).toBe('Summarise it.');
  });

  it('is left alone for a node whose dialog shows its description box', () => {
    const node = NODE_KINDS.output.create('sink');
    node.description = 'The table, one row per country';
    expect(NODE_BUILDERS.output.publishedDescription(node)).toBe('The table, one row per country');
  });
});
