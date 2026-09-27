import { describe, it, expect } from 'vitest';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PageHeading from './PageHeading';
import { useGraphStore } from '@/store/graphStore';

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
