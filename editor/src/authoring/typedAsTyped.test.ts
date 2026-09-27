// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import NodeEditor from '@/canvas/NodeEditor';

/**
 * A node's dialog in a page, typed into as a keyboard types: what a field
 * shows is what was typed -- a space at the end included, while the next key
 * is still to come. A field that showed what the node holds trimmed ate the
 * space, and "a b" came out "ab".
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = () => useGraphStore.getState();
let root: Root;
let page: HTMLElement;
let nodeId: string;

beforeEach(async () => {
  store().newGraph();
  nodeId = store().addNode('code', { x: 0, y: 0 });
  page = document.createElement('div');
  document.body.appendChild(page);
  root = createRoot(page);
  await act(async () => { root.render(createElement(NodeEditor, { nodeId, onClose: () => {} })); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  page.remove();
});

/** The field called *label*, once the node's panel -- loaded when first drawn -- is there. */
async function field(label: string): Promise<HTMLInputElement | HTMLTextAreaElement> {
  for (let tries = 0; tries < 50; tries += 1) {
    const found = page.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
    if (found) return found;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`no field "${label}" in the dialog`);
}

/** *text* put into *box* as one edit: a key pressed, or all of it selected and deleted. */
async function edit(box: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  // The element's own setter, under the one React watches: as the browser sets it.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')!.set!;
  await act(async () => {
    setter.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** *keys* typed at the end of what *box* shows, one at a time; what it shows after each. */
async function type(box: HTMLInputElement | HTMLTextAreaElement, keys: string): Promise<string[]> {
  const shown: string[] = [];
  for (const key of keys) {
    await edit(box, box.value + key);
    shown.push(box.value);
  }
  return shown;
}

describe('a field of a node\'s dialog, typed into', () => {
  it('shows "a", "a ", "a b" as they are typed -- the heading, the text and a ✨ prompt box -- and the node holds "a b"', async () => {
    const heading = await field('Heading');
    // Emptied first: shown empty, and not written -- a heading is never empty.
    await edit(heading, '');
    expect(await type(heading, 'a b')).toEqual(['a', 'a ', 'a b']);

    const text = await field('What it should do');
    expect(await type(text, 'a b')).toEqual(['a', 'a ', 'a b']);

    const prompt = await field('✨ Input prompt');
    await edit(prompt, '');
    expect(await type(prompt, 'a b')).toEqual(['a', 'a ', 'a b']);

    // Closing the dialog writes what waits into the graph.
    await act(async () => { root.unmount(); });
    root = createRoot(page);
    const node = store().rfNodes.find((item) => item.id === nodeId)!.data.graphNode as GraphNode;
    expect(node.label).toBe('a b');
    expect(node.description).toBe('a b');
    expect((node.config.prompts as Record<string, string>).input).toBe('a b');
  });
});
