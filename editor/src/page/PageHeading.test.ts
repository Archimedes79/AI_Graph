import { describe, it, expect } from 'vitest';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PageHeading, { type PageWords } from './PageHeading';
import { useGraphStore } from '@/store/graphStore';
import { syncGuiNodePorts } from '@/document/guiWidgets';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import { NODE_BUILDERS, WIDGET_BUILDERS } from '@/elements/registry';
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

describe('a page\'s own name and description, in the GUI editor', () => {
  const plot = WIDGET_BUILDERS.plot_window.create('Chart');
  const page = (): GraphNode => syncGuiNodePorts({
    id: 'gui1', node_type: 'gui', label: 'GUI Node', description: '', position: { x: 0, y: 0 },
    inputs: [], outputs: [], config: { ...baseNodeConfig(), gui_widgets: [plot] },
  });

  it('are shown above the page, as what they are', () => {
    const html = renderToStaticMarkup(createElement(PageHeading, { nodes: [{ ...page(), description: 'Plots a CSV' }], onChange: () => {} }));
    expect(html).toContain('value="GUI Node"');
    expect(html).toContain('value="Plots a CSV"');
    expect(renderToStaticMarkup(createElement(PageHeading, { nodes: [], onChange: () => {} }))).toBe('');
  });

  it('can be changed there -- and the node wired to a block is told the new name', () => {
    // The bug: a gui node's dialog never opens, so "GUI Node" stayed, and was
    // what every node upstream of a block was told the page is called.
    useGraphStore.getState().loadGraph({
      metadata: { name: 'T', version: '1.0.0', description: '', author: '', tags: [], ai_defaults: { provider: 'default', model: '' }, gui_scheme: 'night' },
      nodes: [page()],
      edges: [],
    });
    const change = (nodeId: string, words: PageWords) => useGraphStore.getState().updateNode(nodeId, words);
    const stored = () => useGraphStore.getState().rfNodes[0].data.graphNode as GraphNode;

    field(PageHeading({ nodes: [stored()], onChange: change }), 'Name of the page')!.onChange({ target: { value: 'Plotter' } });
    field(PageHeading({ nodes: [stored()], onChange: change }), 'What the page is for')!.onChange({ target: { value: 'Plots a CSV' } });

    expect(stored()).toMatchObject({ label: 'Plotter', description: 'Plots a CSV' });
    expect(NODE_BUILDERS.gui.describeAsTarget(stored(), `${plot.id}_in`)).toContain('on the page "Plotter"');
  });
});
