import { describe, it, expect } from 'vitest';
import { liveTypedValues } from './typedValues';
import { blockValue } from './GuiPage';
import { WIDGET_BUILDERS } from '@/elements/registry';

describe('what the designer shows in a block somebody typed into', () => {
  const box = { ...WIDGET_BUILDERS.text_io.create('ask', 'Ask', 'both'), value: 'hello' };

  it('is what was typed, over what arrived, while the block holds it', () => {
    const live = liveTypedValues({ ask: 'hello' }, [box]);
    expect(blockValue(box, 'the reply', live)).toBe('hello');
  });

  it('is what the block holds once a run has sent the message and emptied it', () => {
    // The bug: the box kept showing "hello" after the run cleared it, and ▶ Run
    // then sent the empty box it did not show.
    // The reply is not typed into the box either: it is shown above it, from
    // what arrived.
    const emptied = { ...box, value: '' };
    const live = liveTypedValues({ ask: 'hello' }, [emptied]);
    expect(live).toEqual({});
    expect(blockValue(emptied, 'the reply', live)).toBe('');
    expect(blockValue(emptied, undefined, live)).toBe('');
  });

  it('is what the person typed, not the reply that came back, in a box that also shows', () => {
    // The bug: a reply that came back around a loop was handed to the typing
    // box as its value, so the box showed the reply while ▶ Run sent what had
    // been typed, which the box keeps (`TextIoWidgetRunner.settle`).
    expect(blockValue({ ...box, value: 'my question' }, 'the reply', {})).toBe('my question');
  });

  it('is what arrived, in a box that only shows', () => {
    const shows = { ...WIDGET_BUILDERS.text_io.create('answer', 'Answer', 'output'), value: 'an older answer' };
    expect(blockValue(shows, 'the reply', {})).toBe('the reply');
  });

  it('is the new path once the panel has replaced the one browsed on the block', () => {
    const picker = { ...WIDGET_BUILDERS.input_picker.create('file', 'File'), value: 'data/new.csv' };
    expect(blockValue(picker, undefined, liveTypedValues({ file: 'data/old.csv' }, [picker]))).toBe('data/new.csv');
  });

  it('forgets a block that is no longer on the page', () => {
    expect(liveTypedValues({ gone: 'text' }, [box])).toEqual({});
  });
});
