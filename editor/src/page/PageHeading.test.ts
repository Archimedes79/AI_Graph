import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PageHeading from './PageHeading';
import { insertBlock } from './pageWrite';
import { pageOf } from './GuiPage';
import { useGraphStore } from '@/store/graphStore';
import { WIDGET_BUILDERS } from '@/elements/registry';
import type { GraphNode } from '@/graph';

/** The field of *element* that says it is *name*: what a person types into. */
function field(element: ReactNode, name: string): { onChange: (event: { target: { value: string } }) => void } | undefined {
  if (!element || typeof element !== 'object' || !('props' in element)) return undefined;
  const props = (element as ReactElement).props as Record<string, unknown>;
  if (props['aria-label'] === name) return props as never;
  const children = ([] as ReactNode[]).concat(props.children as ReactNode);
  for (const child of children.flat()) {
    const found = field(child, name);
    if (found) return found;
  }
  return undefined;
}

describe('above the page: the tool\'s name and what it does, which are the graph\'s', () => {
  it('are shown as what they are', () => {
    const html = renderToStaticMarkup(createElement(PageHeading, { name: 'Plotter', description: 'Plots a CSV', onChange: () => {} }));
    expect(html).toContain('value="Plotter"');
    expect(html).toContain('value="Plots a CSV"');
  });

  it('are written into the graph -- its description too, which nothing else sets -- and not into the page\'s node', () => {
    // The page had a name and an "About" of its own, beside the graph's name,
    // and the graph's description -- the one a delivered tool shows -- could be
    // set nowhere.
    useGraphStore.getState().newGraph();
    const heading = () => {
      const { metadata, setMetadata } = useGraphStore.getState();
      return PageHeading({ name: metadata.name, description: metadata.description, onChange: setMetadata });
    };
    field(heading(), 'Name of the tool')!.onChange({ target: { value: 'Plotter' } });
    field(heading(), 'What the tool does')!.onChange({ target: { value: 'Plots a CSV' } });
    expect(useGraphStore.getState().metadata).toMatchObject({ name: 'Plotter', description: 'Plots a CSV' });
    expect(useGraphStore.getState().exportGraph().metadata).toMatchObject({ name: 'Plotter', description: 'Plots a CSV' });
  });
});

describe('the tool\'s name and description, typed above the page', () => {
  const store = () => useGraphStore.getState();
  const blocks = () => pageOf(store().rfNodes.map((n) => n.data.graphNode as GraphNode)).blocks.length;
  beforeEach(() => { vi.useFakeTimers(); store().newGraph(); });
  afterEach(() => { vi.useRealTimers(); });

  it('take an undo step of their own: Undo takes back the description, then the block added before it', () => {
    // They took none: an Undo meant for the block took the description with
    // it, and with nothing before them Undo could not take them back at all.
    insertBlock({ ...WIDGET_BUILDERS.text_io.create('Box'), id: 'box' });
    store().setMetadata({ description: 'Counts the words in a text.' });
    store().undo();
    expect(store().metadata.description).toBe('');
    expect(blocks()).toBe(1);
    store().undo();
    expect(blocks()).toBe(0);
    store().redo();
    store().redo();
    expect(store().metadata.description).toBe('Counts the words in a text.');
  });

  it('are one step per field typed into, not one per keystroke', () => {
    for (const name of ['W', 'Wo', 'Word']) { store().setMetadata({ name }); vi.advanceTimersByTime(300); }
    store().setMetadata({ description: 'Counts.' });
    expect(store().past).toHaveLength(2);
    store().undo();
    expect(store().metadata).toMatchObject({ name: 'Word', description: '' });
    store().undo();
    expect(store().metadata.name).toBe('Untitled Graph');
  });
});
