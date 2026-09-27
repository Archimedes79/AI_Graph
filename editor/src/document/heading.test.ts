import { describe, it, expect } from 'vitest';
import { NODE_KINDS } from './nodeKinds';
import { headingFromText, isNumberedHeading, numberedHeading } from './heading';

/** A node's heading: never empty, numbered when new, and written from its text while nobody has changed it. */

describe('a new node\'s heading', () => {
  it('is its kind and the lowest number no heading beside it has', () => {
    expect(numberedHeading('Code', [])).toBe('Code 1');
    expect(numberedHeading('Code', ['Code 1', 'Code 3', 'AI 2'])).toBe('Code 2');
  });

  it('is given where the node is placed among others, and starts every kind that writes itself', () => {
    const placed = NODE_KINDS.code.placedAmong!(NODE_KINDS.code.create('c2'), [NODE_KINDS.code.create('c1')]);
    expect(placed.label).toBe('Code 2');
    expect(NODE_KINDS.ai.create('a').label).toBe('AI 1');
    expect(NODE_KINDS.data.create('d').label).toBe('Data 1');
  });

  it('counts as nobody\'s while it is still a kind and a number', () => {
    expect(isNumberedHeading('Code 12')).toBe(true);
    expect(isNumberedHeading(' AI 1 ')).toBe(true);
    expect(isNumberedHeading('Count the words')).toBe(false);
    expect(isNumberedHeading('Code')).toBe(false);
  });
});

describe('a heading written from a node\'s text', () => {
  it('is the start of its first sentence, up to where the thought turns, at most six words', () => {
    expect(headingFromText('Reads the CSV and says what the chart should show.')).toBe('Reads the CSV');
    expect(headingFromText('summarize each story: title, then two sentences')).toBe('Summarize each story');
    expect(headingFromText('Counts every word in every file of the folder it is given, then sorts them.')).toBe('Counts every word in every file');
    expect(headingFromText('Answers the message. Knows the history.')).toBe('Answers the message');
  });

  it('is nothing for a text that says nothing', () => {
    expect(headingFromText('')).toBeUndefined();
    expect(headingFromText('   \n  ')).toBeUndefined();
  });
});
