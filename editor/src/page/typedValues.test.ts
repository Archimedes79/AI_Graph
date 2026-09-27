import { describe, it, expect } from 'vitest';
import { liveTypedValues } from './typedValues';
import { blockValue } from './GuiPage';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import type { GraphNode, GuiWidget } from '@/graph';
import { WIDGET_BUILDERS } from '@/elements/registry';

function page(widgets: GuiWidget[]): GraphNode {
  return {
    id: 'gui1', node_type: 'gui', label: 'Page', description: '', position: { x: 0, y: 0 },
    inputs: [], outputs: [], config: { ...baseNodeConfig(), gui_widgets: widgets },
  };
}
const owned = (widgets: GuiWidget[]) => widgets.map((widget) => ({ node: page(widgets), widget }));

describe('what the designer shows in a block somebody typed into', () => {
  const box = { ...WIDGET_BUILDERS.text_io.create('Ask', 'both'), id: 'ask', value: 'hello' };

  it('is what was typed, over what arrived, while the block holds it', () => {
    const blocks = owned([box]);
    const live = liveTypedValues({ ask: 'hello' }, blocks);
    expect(blockValue(blocks[0], 'the reply', live)).toBe('hello');
  });

  it('is what the block holds once a run has sent the message and emptied it', () => {
    // The bug: the box kept showing "hello" after the run cleared it, and ▶ Run
    // then sent the empty box it did not show.
    // The reply is not typed into the box either: it is shown above it, from
    // what arrived.
    const blocks = owned([{ ...box, value: '' }]);
    const live = liveTypedValues({ ask: 'hello' }, blocks);
    expect(live).toEqual({});
    expect(blockValue(blocks[0], 'the reply', live)).toBe('');
    expect(blockValue(blocks[0], undefined, live)).toBe('');
  });

  it('is what the person typed, not the reply that came back, in a box that also shows', () => {
    // The bug: a reply that came back around a loop was handed to the typing
    // box as its value, so the box showed the reply while ▶ Run sent what had
    // been typed, which the box keeps (`TextIoWidgetRunner.settle`).
    const blocks = owned([{ ...box, value: 'my question' }]);
    expect(blockValue(blocks[0], 'the reply', {})).toBe('my question');
  });

  it('is what arrived, in a box that only shows', () => {
    const shows = { ...WIDGET_BUILDERS.text_io.create('Answer', 'output'), id: 'answer', value: 'an older answer' };
    expect(blockValue(owned([shows])[0], 'the reply', {})).toBe('the reply');
  });

  it('is the new path once the panel has replaced the one browsed on the block', () => {
    const picker = { ...WIDGET_BUILDERS.input_picker.create('File'), id: 'file', value: 'data/new.csv' };
    const blocks = owned([picker]);
    expect(blockValue(blocks[0], undefined, liveTypedValues({ file: 'data/old.csv' }, blocks))).toBe('data/new.csv');
  });

  it('forgets a block that is no longer on the page', () => {
    expect(liveTypedValues({ gone: 'text' }, owned([box]))).toEqual({});
  });
});
