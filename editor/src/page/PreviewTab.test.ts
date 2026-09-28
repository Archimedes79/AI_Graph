import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PreviewTab from './PreviewTab';
import DeliveredHeader from './DeliveredHeader';
import { NODE_KINDS } from '@/document/nodeKinds';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so what the tab asks is answered here: a
// graph with a page of one heading. (Vitest lifts both of these above the imports.)
const open = vi.hoisted(() => ({
  metadata: { name: 'Plotter', description: 'Plots a CSV', gui_scheme: 'night' },
  rfNodes: [{
    id: 'page',
    data: { graphNode: { id: 'page', node_type: 'gui', label: 'Page', inputs: [], outputs: [], config: { gui_widgets: [
      { id: 'title', kind: 'text', mode: 'heading', label: '', tone: 'plain', value: 'Population plotter', w: 16, h: 1 },
    ] } } },
  }],
  isExecuting: false, executionResult: null,
  exportGraph: () => ({}), updateNode: () => {}, runGraph: async () => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: Object.assign((select: (state: typeof open) => unknown) => select(open), { getState: () => open }),
}));

describe('the Preview tab', () => {
  it('has no ▶ Run of its own -- the toolbar\'s is the one, on every tab -- and pops the tool out', () => {
    // The Preview header had a ▶ Run beside the toolbar's, and "Open as a tool"
    // was in the Deploy menu, one tab and one menu away from the page it opens.
    const html = renderToStaticMarkup(createElement(PreviewTab));
    expect(html).toContain('Population plotter');
    expect(html).not.toContain('▶ Run</button>');
    expect(html).toMatch(/<button[^>]*title="A window of its own[^"]*"[^>]*>⧉ Open as a tool<\/button>/);
  });

  it('shows a graph without a page as it is delivered: the result of the toolbar\'s ▶ Run', () => {
    // It said "No page yet" and nothing else, where the delivered tool shows
    // what the run handed back.
    const page = open.rfNodes;
    open.rfNodes = [{ id: 'count', data: { graphNode: { ...NODE_KINDS.output.create('count'), label: 'Words' } } }] as never;
    open.executionResult = {
      status: 'success',
      node_results: [{ node_id: 'count', status: 'success', inputs: { value: 'forty-two words' }, outputs: { value: 'forty-two words' } }],
      outputs: { Words: { value: 'forty-two words' } },
    } as never;
    try {
      const html = renderToStaticMarkup(createElement(PreviewTab));
      expect(html).toContain('No page yet');
      expect(html).toContain('forty-two words');
    } finally {
      open.rfNodes = page;
      open.executionResult = null;
    }
  });

  it('says a graph of nothing has no nodes yet, run or not -- not that it is ready to run', () => {
    const page = open.rfNodes;
    open.rfNodes = [];
    open.executionResult = { status: 'success', node_results: [], outputs: {} } as never;
    try {
      const html = renderToStaticMarkup(createElement(PreviewTab));
      expect(html).toContain('This graph has no nodes yet.');
      expect(html).not.toContain('ready to run');
    } finally {
      open.rfNodes = page;
      open.executionResult = null;
    }
  });

  it('keeps the delivered tool\'s ▶ Run: a tool someone was handed has no toolbar', () => {
    const header = (onRun?: () => void) => renderToStaticMarkup(createElement(DeliveredHeader, { onRun }));
    expect(header(() => {})).toContain('▶ Run</button>');
    expect(header()).not.toContain('▶ Run');
    // What the tool is, from the graph: its name and what it does.
    expect(header()).toContain('Plotter');
    expect(header()).toContain('Plots a CSV');
  });
});
