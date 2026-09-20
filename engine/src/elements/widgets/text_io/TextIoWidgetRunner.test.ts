import { describe, it, expect } from 'vitest';
import { TextIoWidgetRunner } from './TextIoWidgetRunner.ts';
import type { Widget } from '../../WidgetRunner.ts';

/**
 * A box of text holds one of two things, and the difference is what happens to
 * it after a run.
 *
 * A box that sends on Enter holds a *message*: said once, and emptied when a
 * run has delivered it, so the box is ready for the next one. A box that does
 * not send holds a *setting* -- a search term, a name -- and emptying that
 * after every run would make the person retype it every time.
 *
 * The rule used to live in the editor's `WidgetGuiBuilder`, which meant the one store
 * both hosts share had to reach into the builder's registry to ask it. What a
 * run means for a block is the block's own business, the same family as
 * `settle`, so it is asked of the element here.
 */
const element = new TextIoWidgetRunner();

const box = (config: Record<string, unknown>): Widget => ({
  id: 'box', kind: 'text_io', label: 'Box', w: 4, h: 2, tone: 'sunken', config,
});

describe('what a run leaves in a text box', () => {
  it('empties a box that sends, because a message is said once', () => {
    expect(element.clearsValueAfterRun(box({ mode: 'both', run_on_change: true }))).toBe(true);
    expect(element.clearsValueAfterRun(box({ mode: 'input', run_on_change: true }))).toBe(true);
  });

  it('leaves a box that does not send, because that is a setting', () => {
    expect(element.clearsValueAfterRun(box({ mode: 'both' }))).toBe(false);
    expect(element.clearsValueAfterRun(box({ mode: 'input', run_on_change: false }))).toBe(false);
  });

  it('leaves a box that only shows: there is nothing of the person\'s in it', () => {
    expect(element.clearsValueAfterRun(box({ mode: 'output', run_on_change: true }))).toBe(false);
  });

  it('reads an unknown mode as "both", the way its ports do', () => {
    // One rule, not two: `config()` decides the role for the ports, for what a
    // run produces and for this, so a box with no mode set behaves the same in
    // all three.
    expect(element.clearsValueAfterRun(box({ run_on_change: true }))).toBe(true);
    expect(element.clearsValueAfterRun(box({ mode: 'nonsense', run_on_change: true }))).toBe(true);
  });
});
