import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ApplicationView from './ApplicationView';
import DeliveredHeader from './DeliveredHeader';
import { NODE_KINDS } from '@/document/nodeKinds';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so what the tab asks is answered here: a
// graph with a page of one heading. (Vitest lifts both of these above the imports.)
const open = vi.hoisted(() => {
  const state = {
    metadata: { name: 'Plotter', description: 'Plots a CSV', gui_scheme: 'night' },
    rfNodes: [{
      id: 'page',
      data: { graphNode: { id: 'page', node_type: 'gui', label: 'Page', inputs: [], outputs: [], config: { gui_widgets: [
        { id: 'title', kind: 'text', mode: 'heading', label: '', tone: 'plain', value: 'Population plotter', w: 16, h: 1 },
      ] } } },
    }] as unknown[],
    holdDocument: async () => {},
    rootGraph: () => ({ metadata: state.metadata, nodes: state.rfNodes.map((node) => (node as { data: { graphNode: unknown } }).data.graphNode), edges: [] }),
  };
  return state;
});
vi.mock('@/store/graphStore', () => ({
  useGraphStore: Object.assign((select: (state: typeof open) => unknown) => select(open), { getState: () => open }),
}));

// The session, answered the same way: what the server last said of it.
const said = vi.hoisted(() => ({ view: null as unknown, round: null, edits: {}, sent: {} }));
vi.mock('@/api/session', async (actual) => ({
  ...(await actual<typeof import('@/api/session')>()),
  useSession: Object.assign((select?: (state: typeof said) => unknown) => (select ? select(said) : said), { getState: () => said }),
}));

const session = (outputs: Record<string, unknown>) => {
  said.view = {
    session: 's1', values: {}, outputs, rounds: 1, finished_at: 1, round: null, dropped: [], design_revision: 0,
    clock: { running: false, runs_by_itself: false, ticks: false, next_at: null, problem: null },
  };
};

describe('the application, running', () => {
  it('has no ▶ Run of its own -- ▶ Run started it, and its page runs the graph -- and pops the tool out', () => {
    const html = renderToStaticMarkup(createElement(ApplicationView));
    expect(html).toContain('Population plotter');
    expect(html).not.toContain('▶ Run</button>');
    expect(html).toMatch(/<button[^>]*title="A window of its own[^"]*"[^>]*>⧉ Open as a tool<\/button>/);
  });

  it('shows a graph without a page as it is delivered: what its run handed back, under each output\'s label', () => {
    // It said "No page yet" and nothing else, where the delivered tool shows
    // what the run handed back.
    const page = open.rfNodes;
    open.rfNodes = [{ id: 'count', data: { graphNode: { ...NODE_KINDS.output.create('count'), label: 'Words' } } }];
    session({ count: 'forty-two words' });
    try {
      const html = renderToStaticMarkup(createElement(ApplicationView));
      expect(html).toContain('forty-two words');
      expect(html).toContain('>Words</h3>');
    } finally {
      open.rfNodes = page;
      said.view = null;
    }
  });

  it('says a graph of nothing has no nodes yet, run or not -- not that it is ready to run', () => {
    const page = open.rfNodes;
    open.rfNodes = [];
    session({});
    try {
      const html = renderToStaticMarkup(createElement(ApplicationView));
      expect(html).toContain('This graph has no nodes yet.');
      expect(html).not.toContain('ready to run');
    } finally {
      open.rfNodes = page;
      said.view = null;
    }
  });

  it('has a delivered tool say what it is, and offer no ▶ Run: started, it runs when its page is used', () => {
    const header = renderToStaticMarkup(createElement(DeliveredHeader, { name: 'Plotter', description: 'Plots a CSV', round: null }));
    expect(header).not.toContain('▶ Run');
    // What the tool is: its name and what it does.
    expect(header).toContain('Plotter');
    expect(header).toContain('Plots a CSV');
  });
});
