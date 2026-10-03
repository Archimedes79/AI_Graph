import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NODE_KINDS } from '@/document/nodeKinds';
import { pageOf } from '@/document/guiWidgets';
import type { GraphNode } from '@/graph';
import type { PageSession } from '@/api/session';
import { GuiSurfacePage } from './GuiPage';
import { pageInUse } from './pageInUse';

const output = { ...NODE_KINDS.output.create('count'), label: 'Words' } as GraphNode;

/** The session once a round has run: the output "count" handed back. */
const ran: PageSession = {
  view: {
    session: 's1', values: {}, outputs: { count: 'forty-two words' }, rounds: 1, finished_at: 1, round: null, dropped: [],
    clock: { running: false, runs_by_itself: false, ticks: false, next_at: null, problem: null },
  },
  round: null, edits: {}, sent: {},
};

/** The page *nodes* make, drawn as a tool draws it once a round has run. */
const drawn = (nodes: GraphNode[]) => renderToStaticMarkup(createElement(GuiSurfacePage, {
  page: pageInUse({
    name: 'Word counter',
    description: 'Counts the words.',
    scheme: 'night',
    blocks: pageOf(nodes).widgets,
    outputs: [{ name: 'count', label: 'Words' }],
  }, ran),
  onValue: () => {},
  onEvent: () => {},
}));

describe('a tool whose page has no blocks, after ▶ Run', () => {
  it('shows what the tool does and what its run handed back', () => {
    const html = drawn([output]);
    expect(html).toContain('Counts the words.');
    expect(html).toContain('forty-two words');
  });

  it('shows the same with a page node whose last block is gone: a page is its blocks', () => {
    // The page node stayed after its last block was removed, and the tool
    // drew an empty page where the run's result belongs.
    const html = drawn([NODE_KINDS.gui.create('page'), output]);
    expect(html).toContain('Counts the words.');
    expect(html).toContain('forty-two words');
  });
});
