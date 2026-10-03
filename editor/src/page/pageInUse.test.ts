// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GuiWidget } from '@/graph';
import { GuiSurfacePage, type PageModel } from './GuiPage';

/**
 * A page in use, pressed and changed as a person does: what a block now holds
 * is handed on only for a block a round is given a value by, and a block that
 * starts the graph starts it by its name. A button pressed once sent its
 * press count as a value no graph takes, and the server turned the round down.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const blocks = [
  { id: 'go', kind: 'button', label: 'Go', w: 4, h: 1 },
  { id: 'pick', kind: 'select', label: 'Pick', options: 'a\nb', value: 'a', w: 4, h: 1 },
] as GuiWidget[];
const page: PageModel = {
  name: 'Tool', description: '', scheme: 'night', blocks,
  valueOf: (block) => block.value, shownOn: () => undefined, busy: false, error: '', outputs: [],
};

let root: Root;
let host: HTMLElement;
/** What the page told its host, in order. */
const told: string[] = [];

beforeEach(async () => {
  told.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(GuiSurfacePage, {
      page,
      onValue: (block, value) => { told.push(`value ${block.id} ${JSON.stringify(value)}`); },
      onEvent: (block) => { told.push(`event ${block.id}`); },
    }));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe('a page in use', () => {
  it('starts a round by a button\'s name, and hands on no value of it: a press is an event', async () => {
    await act(async () => { host.querySelector('button')!.click(); });
    expect(told).toEqual(['event go']);
  });

  it('hands on what a block that takes a value now holds, before the round it starts', async () => {
    const select = host.querySelector('select')!;
    await act(async () => {
      select.value = 'b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(told[0]).toBe('value pick "b"');
  });
});
