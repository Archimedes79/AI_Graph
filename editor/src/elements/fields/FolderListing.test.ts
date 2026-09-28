// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import FolderListing from './FolderListing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('a folder\'s listing, shown', () => {
  it('drops a listing that comes back after what it was of changed', async () => {
    // "Look into subfolders too" ticked while a slow listing was on its way:
    // the list from before the tick was shown under it.
    let answer: (files: string[]) => void = () => {};
    const list = () => new Promise<string[]>((resolve) => { answer = resolve; });
    const drawn = (of: string) => createElement(FolderListing, { recursive: of === 'deep', onRecursive: () => {}, noFolder: false, list, of });
    const page = document.createElement('div');
    document.body.appendChild(page);
    const root = createRoot(page);
    await act(async () => { root.render(drawn('flat')); });
    await act(async () => { page.querySelector('button')!.click(); });
    await act(async () => { root.render(drawn('deep')); });
    await act(async () => { answer(['data/a.csv']); });
    expect(page.textContent).not.toContain('data/a.csv');
    expect(page.textContent).toContain('Show the files it lists');
    await act(async () => { root.unmount(); });
    page.remove();
  });
});
