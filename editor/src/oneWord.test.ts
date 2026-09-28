import { describe, it, expect, vi } from 'vitest';
import { createElement, type ComponentType, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from 'reactflow';
import ViewTabs from '@/app/ViewTabs';
import Sidebar from '@/app/Sidebar';
import ApplicationView from '@/page/ApplicationView';
import PageHeading from '@/page/PageHeading';
import WidgetEditor from '@/page/WidgetEditor';
import TopGraphOnly from '@/page/TopGraphOnly';
import GraphNodeView from '@/canvas/GraphNodeView';
import { removalsToApply } from '@/canvas/nodeRemoval';
import { NODE_BUILDERS, WIDGET_BUILDERS } from '@/elements/registry';
import type { WidgetGuiBuilder, WidgetPanelProps } from '@/elements/WidgetGuiBuilder';
import { DisplayWidgetGuiBuilder } from '@/elements/widgets/DisplayWidgetGuiBuilder';
import { NODE_KINDS } from '@/document/nodeKinds';
import { syncGuiNodePorts } from '@/document/guiWidgets';
import type { GraphNode } from '@/graph';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so the graph is answered here: one page
// of two blocks. (Vitest lifts both of these above the imports.)
const open = vi.hoisted(() => ({
  metadata: { name: 'Plotter', description: '', gui_scheme: 'night' },
  rfNodes: [] as unknown[], rfEdges: [], subgraphStack: [] as unknown[],
  isExecuting: false, executionResult: null,
  exportGraph: () => ({}), updateNode: () => {}, runGraph: async () => {},
  setEditingNode: () => {}, deleteNode: () => {}, closeSubgraphsTo: () => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: Object.assign((select: (state: typeof open) => unknown) => select(open), { getState: () => open }),
}));

const blank = NODE_KINDS.gui.create('page');
const page: GraphNode = syncGuiNodePorts({ ...blank, config: { ...blank.config, gui_widgets: [
  { ...WIDGET_BUILDERS.input_picker.create('CSV file'), id: 'file' },
  { ...WIDGET_BUILDERS.plot_window.create('Chart'), id: 'plot' },
] } });
open.rfNodes = [{ id: 'page', data: { graphNode: page } }];

/** What a person reads: the text, and the words in a tooltip, a placeholder or a label for a screen reader. */
function read(element: ReactElement): string {
  const html = renderToStaticMarkup(element);
  const said = [...html.matchAll(/(?:title|placeholder|aria-label|alt)="([^"]*)"/g)].map((match) => match[1]);
  return [html.replace(/<[^>]*>/g, ' '), ...said].join(' ');
}

const OTHER_WORDS = /\b(widgets?|gui|interfaces?|designer)\b/i;

/**
 * Each block kind's settings panel, to be drawn by itself: registered lazily,
 * a panel drawn inside WidgetEditor is its Suspense fallback, and says nothing.
 */
const PANELS = import.meta.glob('/src/elements/widgets/**/*WidgetPanel.tsx', { eager: true, import: 'default' }) as Record<string, ComponentType<WidgetPanelProps>>;
const pascal = (kind: string) => kind.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('');
/** The panel of *builder*'s kind: its own, or -- a chart, a table, an image -- the one the blocks that show share. */
const panelOf = (builder: WidgetGuiBuilder): ComponentType<WidgetPanelProps> | undefined =>
  PANELS[`/src/elements/widgets/${builder.widgetKind}/${pascal(builder.widgetKind)}WidgetPanel.tsx`]
  ?? (builder instanceof DisplayWidgetGuiBuilder ? PANELS['/src/elements/widgets/DisplayWidgetPanel.tsx'] : undefined);

describe('"block" is the one word for what a page is made of', () => {
  it('names the tabs Graph and Page -- and App while the application runs -- and counts the page\'s blocks', () => {
    const drawn = (running: boolean) => renderToStaticMarkup(createElement(ViewTabs, { view: 'graph', onChange: () => {}, running }));
    const tabs = (running: boolean) => [...drawn(running).matchAll(/<button[^>]*>(?:<span[^>]*>●<\/span>)?([^<]*)/g)].map((match) => match[1]);
    expect(tabs(false)).toEqual(['Graph', 'Page']);
    expect(tabs(true)).toEqual(['Graph', 'Page', 'App']);
    expect(drawn(false)).toMatch(/Page<span[^>]*>2<\/span>/);
  });

  it('is all there is in what the page\'s views, its node and its blocks\' editors say', () => {
    const shown: Record<string, string> = {
      tabs: read(createElement(ViewTabs, { view: 'design', onChange: () => {}, running: true })),
      palette: read(createElement(Sidebar, { onAddNode: () => {} })),
      application: read(createElement(ApplicationView)),
      heading: read(createElement(PageHeading, { name: 'Plotter', description: '', onChange: () => {} })),
      'the page on the canvas': read(createElement(ReactFlowProvider, null, createElement(GraphNodeView, {
        id: 'page', data: { graphNode: page }, selected: false, type: 'graphNode', zIndex: 0, isConnectable: true,
        xPos: 0, yPos: 0, dragging: false,
      }))),
      'the page node': [NODE_BUILDERS.gui.label, NODE_BUILDERS.gui.hint, NODE_BUILDERS.gui.describeOutput(page), NODE_KINDS.gui.create('p').label].join(' '),
    };
    for (const builder of Object.values(WIDGET_BUILDERS) as WidgetGuiBuilder[]) {
      shown[`the editor of a ${builder.widgetKind}`] = read(createElement(WidgetEditor, { widget: { ...builder.create('Block'), id: 'b' }, onChange: () => {} }));
      const Panel = panelOf(builder);
      // Every kind with settings has its panel read here, not only the one that was.
      expect(!!Panel, builder.widgetKind).toBe(!!builder.Panel);
      if (!Panel) continue;
      for (const { mode } of builder.paletteEntries()) {
        shown[`the settings of a ${builder.widgetKind}${mode ? `, ${mode}` : ''}`] = read(createElement(Panel, {
          builder, widget: { ...builder.create('Block', mode), id: 'b' }, onUpdate: () => {},
        }));
      }
    }
    open.subgraphStack = [{ nodeId: 'part' }];
    try {
      shown['inside a node\'s graph'] = read(createElement(TopGraphOnly, null, 'the page'));
    } finally {
      open.subgraphStack = [];
    }
    for (const [where, text] of Object.entries(shown)) expect(text, where).not.toMatch(OTHER_WORDS);
  });

  it('is what deleting the page asks about', () => {
    let asked = '';
    removalsToApply([{ type: 'remove', id: 'page' }], () => page, (question) => { asked = question; return false; });
    expect(asked).toBe('Delete the page? Its 2 blocks go with it.');
  });
});
