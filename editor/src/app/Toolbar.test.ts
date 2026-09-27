import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Toolbar, { graphBusy, lastAsked } from './Toolbar';
import { fileActions } from './FileMenu';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so what the toolbar asks is answered
// here. (Vitest lifts both of these above the imports.)
const open = vi.hoisted(() => ({
  metadata: { name: 'Graph', description: '', gui_scheme: 'night' },
  rfNodes: [], rfEdges: [], past: [], future: [], subgraphStack: [],
  isExecuting: false, isProject: true, runProgress: null, executionResult: null,
  isDirty: () => false,
  setMetadata: () => {}, stopRun: () => {}, undo: () => {}, redo: () => {}, loadGraph: () => {},
  exportGraph: () => ({}), updateNode: () => {}, runGraph: async () => {}, closeSubgraphsTo: () => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: Object.assign((select: (state: typeof open) => unknown) => select(open), { getState: () => open }),
}));

function toolbar(): string {
  return renderToStaticMarkup(createElement(Toolbar, {
    onNewGraph: () => {}, onSave: () => {}, onSaveAs: () => {}, onReloadProject: () => {}, onLoad: () => {},
    onInjectJson: () => {}, onOpenSettings: () => {}, confirmDiscard: () => true,
    currentFilePath: '/p/graph', saveStatus: '', view: 'graph', onViewChange: () => {},
  }));
}

/** The toolbar button labelled *label*, as drawn. */
const button = (html: string, label: string): string =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';

/** The File menu's entries, with every handler a no-op. */
const entries = (busyWith: string | null, isProject = true) => fileActions({
  busyWith, isProject,
  onNew: () => {}, onDesign: () => {}, onOpen: () => {}, onSave: () => {}, onSaveAs: () => {}, onReload: () => {}, onJson: () => {},
});

describe('opening another graph', () => {
  it('waits while a run is going: what the run brings back is for the graph it started on (B30)', () => {
    const reason = graphBusy(true, false);
    const blocked = entries(reason).filter((entry) => entry.blocked).map((entry) => entry.label);
    expect(blocked).toEqual(['New', 'Open…', 'Reload from disk']);
    // Saying why, where it would be clicked.
    for (const entry of entries(reason).filter((each) => each.blocked)) expect(entry.blocked).toMatch(/A run is going/);
    expect(entries(null).some((entry) => entry.blocked)).toBe(false);
  });

  it('says why, for a run and for a ✨ sweep alike', () => {
    expect(graphBusy(false, false)).toBeNull();
    expect(graphBusy(true, false)).toMatch(/run/);
    expect(graphBusy(false, true)).toMatch(/✨/);
  });
});

describe('the File menu', () => {
  it('holds every file action -- New, ✨ AI Graph, Open, Save, Save as, Reload in a project, JSON -- with Save\'s key', () => {
    expect(entries(null).map((entry) => entry.label)).toEqual([
      'New', '✨ AI Graph…', 'Open…', 'Save', 'Save as…', 'Reload from disk', 'Copy / paste as JSON…',
    ]);
    expect(entries(null).find((entry) => entry.label === 'Save')?.shortcut).toBe('Ctrl+S');
    // A graph that is not a project has nothing to reload.
    expect(entries(null, false).map((entry) => entry.label)).not.toContain('Reload from disk');
  });

  it('is one button in the header, which says it opens a menu', () => {
    const file = toolbar().match(/<button[^>]*aria-haspopup="menu"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(file).toContain('>File');
    expect(file).toContain('aria-expanded="false"');
  });
});

describe('▶ Run', () => {
  it('is one button that runs the graph, the same with a page as without: never a Start that only opens the page', () => {
    // A graph with a page had ▶ Start, which switched to the Preview tab, whose
    // header then had a ▶ Run of its own: three names for starting one graph.
    const page = { id: 'page', node_type: 'gui', label: 'Page', inputs: [], outputs: [],
      config: { gui_widgets: [{ id: 'go', kind: 'button', label: 'Go', tone: 'plain' }] } };
    const before = open.rfNodes;
    (open as { rfNodes: unknown[] }).rfNodes = [{ id: 'page', data: { graphNode: page } }];
    try {
      const html = toolbar();
      const run = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Run<\/button>/)?.[0] ?? '';
      expect(run).toContain('Run the whole graph');
      expect(html).not.toMatch(/>Start</);
    } finally {
      (open as { rfNodes: unknown[] }).rfNodes = before;
    }
  });

  it('leaves the Deploy button one thing to do: the zip, with no menu to open first', () => {
    expect(button(toolbar(), 'Deploy')).toMatch(/title="Download this graph as a tool of its own/);
  });
});

describe('the header', () => {
  it('says the app\'s name, the graph\'s, and holds the three views', () => {
    const html = toolbar();
    expect(html).toContain('>AI-Graph</span>');
    expect(html).toMatch(/<input[^>]*aria-label="The graph&#x27;s name"[^>]*value="Graph"/);
    expect([...html.matchAll(/<button[^>]*aria-current="page"[^>]*>([^<]*)/g)].map((match) => match[1])).toEqual(['Graph']);
  });

  it('fits a window 1024 pixels wide: its buttons are their icons below 1280, and what does not fit scrolls inside it, never the page', () => {
    // It was 1470 pixels wide there, and the page slid sideways under it,
    // palette and tabs out of view.
    const html = toolbar();
    expect(html.match(/<header[^>]*>/)?.[0]).toMatch(/class="[^"]*\bmin-w-0\b[^"]*\boverflow-x-auto\b/);
    const labels = html.match(/<span[^>]*>(Generate|Settings|Deploy)<\/span>/g) ?? [];
    expect(labels).toHaveLength(3);
    for (const label of labels) expect(label).toContain('hidden xl:inline');
    // Each is still named, for a tooltip and a screen reader -- Undo and Redo only ever as icons.
    for (const name of ['Generate', 'Settings', 'Deploy', 'Undo (Ctrl+Z)', 'Redo (Ctrl+Shift+Z)']) expect(button(html, name.replace(/[()+]/g, '\\$&'))).toContain('title=');
  });
});

describe('✨ AI Graph\'s Cancel', () => {
  it('leaves the design on its way unwanted, and a new one wanted (B36)', () => {
    // Cancel closed the dialog and let the request run on: opened again, the
    // dialog offered the old design as the answer to a new, empty description.
    const asked = lastAsked();
    const first = asked.ask();
    expect(first()).toBe(true);
    asked.cancel();
    expect(first()).toBe(false);
    const second = asked.ask();
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });
});
