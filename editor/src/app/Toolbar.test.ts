import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Toolbar, { graphBusy } from './Toolbar';

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
    currentFilePath: '/p/graph', saveStatus: '', onShowInterface: () => {}, interfaceShown: false,
  }));
}

/** The toolbar button labelled *label*, as drawn. */
const button = (html: string, label: string): string =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? '';
const RELOAD = 'Reload the whole project from disk';

describe('opening another graph', () => {
  it('waits while a run is going: what the run brings back is for the graph it started on (B30)', () => {
    open.isExecuting = true;
    try {
      const html = toolbar();
      for (const label of ['New', 'Open']) expect(button(html, label)).toContain('disabled=""');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="A run is going[^"]*"[^>]*aria-label="A run is going/);
    } finally {
      open.isExecuting = false;
    }
    const html = toolbar();
    for (const label of ['New', 'Open', `${RELOAD}[^"]*`]) expect(button(html, label)).not.toContain('disabled');
  });

  it('says why, for a run and for a ✨ sweep alike', () => {
    expect(graphBusy(false, false)).toBeNull();
    expect(graphBusy(true, false)).toMatch(/run/);
    expect(graphBusy(false, true)).toMatch(/✨/);
  });
});
