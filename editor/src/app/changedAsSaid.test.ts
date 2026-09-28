// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Graph } from '@/graph';

/**
 * A change of the whole graph said in the bar under the canvas, applied: the
 * note that says so, and offers to undo it, is there while Undo would undo
 * that change -- and not once another step came after it.
 */

// ✨ AI Graph's server: the graph it was sent, with its first node renamed.
vi.mock('@/api/client', async (actual) => ({
  ...(await actual<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body: { graph: Graph }) => {
    if (route === 'generationProgress') return { calls: [] };
    if (route !== 'generateGraph') throw new Error(`not expected here: ${route}`);
    const [first, ...rest] = body.graph.nodes;
    return { graph: { ...body.graph, nodes: [{ ...first, label: 'Count words' }, ...rest] }, explanation: 'Renamed.' };
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useGraphStore } = await import('@/store/graphStore');
const { NODE_KINDS } = await import('@/document/nodeKinds');
const { default: ChangeBar } = await import('./ChangeBar');

const store = () => useGraphStore.getState();
let root: Root;
let page: HTMLElement;

beforeEach(async () => {
  store().loadGraph({ metadata: { name: 'Words', description: '', gui_scheme: 'night' }, nodes: [NODE_KINDS.code.create('count')], edges: [] });
  page = document.createElement('div');
  document.body.appendChild(page);
  root = createRoot(page);
  await act(async () => { root.render(createElement(ChangeBar)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  page.remove();
});

/** The button reading *text*. */
const button = (text: string) => [...page.querySelectorAll('button')].find((each) => each.textContent?.trim() === text);

/** *words* said in the bar, the graph changed as said, and the change applied. */
async function changed(words: string): Promise<void> {
  const field = page.querySelector<HTMLInputElement>('[aria-label="Say what to change"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(field, words);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { button('Change')!.click(); });
  for (let tries = 0; tries < 50 && !button('Apply'); tries += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  await act(async () => { button('Apply')!.click(); });
}

const noted = () => page.textContent?.includes('The graph was changed as said.') ?? false;

describe('the note that a change was applied', () => {
  it('goes once another step comes after the change, with the history full as with it empty', async () => {
    // Fifty steps are kept. Once there were fifty, the next edit left their
    // number as it was, and the note stayed -- its ↶ Undo undoing that edit.
    await act(async () => {
      for (let step = 0; step < 60; step += 1) store().updateNode('count', { description: `Take ${step}` });
    });
    expect(store().past).toHaveLength(50);
    await changed('Call it what it counts.');
    expect(noted()).toBe(true);
    await act(async () => { store().updateNode('count', { description: 'One more' }); });
    expect(noted()).toBe(false);
  });

  it('goes when the change is undone, and is back when it is redone', async () => {
    await changed('Call it what it counts.');
    expect(noted()).toBe(true);
    await act(async () => { store().undo(); });
    expect(noted()).toBe(false);
    await act(async () => { store().redo(); });
    expect(noted()).toBe(true);
  });
});
