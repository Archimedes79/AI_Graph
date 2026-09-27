import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from 'reactflow';
import ViewTabs from '@/app/ViewTabs';
import Sidebar from '@/app/Sidebar';
import PreviewTab from '@/page/PreviewTab';
import PageHeading from '@/page/PageHeading';
import WidgetEditor from '@/page/WidgetEditor';
import TopGraphOnly from '@/page/TopGraphOnly';
import GraphNodeView from '@/canvas/GraphNodeView';
import TextIoWidgetPanel from '@/elements/widgets/text_io/TextIoWidgetPanel';
import { removalsToApply } from '@/canvas/nodeRemoval';
import { NODE_BUILDERS, WIDGET_BUILDERS } from '@/elements/registry';
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

describe('"block" is the one word for what a page is made of', () => {
  it('names the tabs Graph, Page and Preview, and counts the page\'s blocks', () => {
    const html = renderToStaticMarkup(createElement(ViewTabs, { view: 'graph', onChange: () => {} }));
    const tabs = [...html.matchAll(/<button[^>]*>([^<]*)/g)].map((match) => match[1]);
    expect(tabs).toEqual(['Graph', 'Page', 'Preview']);
    expect(html).toMatch(/Page<span[^>]*>2<\/span>/);
  });

  it('is all there is in what the page\'s views, its node and its blocks\' editors say', () => {
    const shown: Record<string, string> = {
      tabs: read(createElement(ViewTabs, { view: 'design', onChange: () => {} })),
      palette: read(createElement(Sidebar, { onAddNode: () => {} })),
      preview: read(createElement(PreviewTab)),
      heading: read(createElement(PageHeading, { name: 'Plotter', description: '', onChange: () => {} })),
      'the page on the canvas': read(createElement(ReactFlowProvider, null, createElement(GraphNodeView, {
        id: 'page', data: { graphNode: page }, selected: false, type: 'graphNode', zIndex: 0, isConnectable: true,
        xPos: 0, yPos: 0, dragging: false,
      }))),
      'the page node': [NODE_BUILDERS.gui.label, NODE_BUILDERS.gui.hint, NODE_BUILDERS.gui.describeOutput(page), NODE_KINDS.gui.create('p').label].join(' '),
    };
    for (const builder of Object.values(WIDGET_BUILDERS)) {
      shown[`the editor of a ${builder.widgetKind}`] = read(createElement(WidgetEditor, { widget: { ...builder.create('Block'), id: 'b' }, onChange: () => {} }));
    }
    for (const mode of ['input', 'output', 'both']) {
      shown[`a text box's settings, ${mode}`] = read(createElement(TextIoWidgetPanel, {
        builder: WIDGET_BUILDERS.text_io, widget: { ...WIDGET_BUILDERS.text_io.create('Box', mode), id: 'box' }, onUpdate: () => {},
      }));
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
