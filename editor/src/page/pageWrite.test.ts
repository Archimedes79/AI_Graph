import { describe, it, expect, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { insertBlock, moveBlock, patchBlock, removeBlock } from './pageWrite';
import { usePageEvents } from './GuiPage';
import { pageOf } from '@/document/guiWidgets';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import type { GraphNode, GuiWidget } from '@/graph';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { useGraphStore } from '@/store/graphStore';

function guiNode(id: string, widgets: GuiWidget[]): GraphNode {
  return {
    id,
    node_type: 'gui',
    label: id,
    description: '',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    config: { ...baseNodeConfig(), gui_widgets: widgets },
  };
}

const store = () => useGraphStore.getState();
const page = () => pageOf(store().rfNodes.map((n) => n.data.graphNode as GraphNode));
const shown = () => page().widgets;

describe('the page', () => {
  beforeEach(() => store().newGraph());

  it('is one node: its first block makes it, and every block after lands on it', () => {
    insertBlock(WIDGET_BUILDERS.text.create('title', 'Title', 'heading'));
    const made = page().page!;
    // Called what it is, as in the examples' flow.json -- not the file format's `gui`.
    expect(made.id).toBe('page');
    expect(store().rfNodes).toHaveLength(1);
    insertBlock(WIDGET_BUILDERS.text_io.create('answer', 'Answer', 'output'));
    expect(store().rfNodes).toHaveLength(1);
    expect(page().page!.id).toBe(made.id);
    expect(shown().map((w) => w.id)).toEqual(['title', 'answer']);
    // Its ports follow its blocks.
    expect(page().page!.inputs.map((port) => port.id)).toEqual(['answer_in']);
  });

  it('is made by its first block in that block\'s undo step, and one Undo takes both', () => {
    // Two steps, and one Undo left a page node with no blocks: a page to a
    // delivered tool and a bundle, which drew nothing on it.
    const chart = WIDGET_BUILDERS.plot_window.create('chart', 'Chart');
    insertBlock(chart);
    expect(store().past).toHaveLength(1);
    expect(shown()).toEqual([chart]);
    store().undo();
    expect(store().rfNodes).toEqual([]);
    store().redo();
    expect(shown()).toEqual([chart]);
  });

  it('goes with its last block', () => {
    insertBlock(WIDGET_BUILDERS.plot_window.create('chart', 'Chart'));
    removeBlock('chart');
    expect(store().rfNodes).toEqual([]);
    // Undo brings the block back, and the page with it.
    store().undo();
    expect(shown().map((w) => w.id)).toEqual(['chart']);
  });

  it('is made beside the nodes on the canvas, not on top of the first', () => {
    // The palette's first node lands at (200, 120); the page went to (240, 160).
    const code = store().addNode('code', { x: 200, y: 120 });
    insertBlock(WIDGET_BUILDERS.text.create('title', 'Title', 'heading'));
    const at = (id: string) => store().rfNodes.find((n) => n.id === id)!.position;
    expect(at(page().page!.id).x).toBeGreaterThanOrEqual(at(code).x + 240);
    expect(at(page().page!.id).y).toBe(at(code).y);
  });

  it('is the first one, where a graph has two -- a problem `check` names -- and the second is left as it is', () => {
    // The page was every gui node's blocks in graph order, and an edit was
    // routed back to whichever node held the block.
    const a = WIDGET_BUILDERS.text.create('a', 'A');
    const b = WIDGET_BUILDERS.text.create('b', 'B');
    store().loadGraph({ metadata: { name: 'Two', description: '', gui_scheme: 'night' }, nodes: [guiNode('first', [a]), guiNode('second', [b])], edges: [] });
    expect(page().page!.id).toBe('first');
    expect(shown().map((w) => w.id)).toEqual(['a']);
    insertBlock(WIDGET_BUILDERS.divider.create('d', ''), 0);
    patchBlock('b', { label: 'not on the page' });
    const second = store().rfNodes.find((n) => n.id === 'second')!.data.graphNode as GraphNode;
    expect(second.config.gui_widgets).toEqual([b]);
    expect(shown().map((w) => w.id)).toEqual(['d', 'a']);
  });
});

describe('a block edited on the page', () => {
  beforeEach(() => store().newGraph());

  it('keeps the keystroke that made a heading grow: the text and the height land together (B31)', () => {
    // A box that grows as it is typed into changes its block twice in one
    // keystroke: the text, then the height. The height was written onto the
    // page as it had been drawn, and put the text back from before the key.
    insertBlock({ ...WIDGET_BUILDERS.text.create('text', '', 'heading'), value: 'Hel', w: 16, h: 1 });
    const undo = store().past.length;
    patchBlock('text', { value: 'Hell' });
    patchBlock('text', { h: 2 });
    expect(shown()[0]).toMatchObject({ value: 'Hell', h: 2 });
    expect(store().past.length).toBe(undo + 2);
  });

  it('changes a block on the page as it is by then, keeping what was added, renamed and deleted meanwhile', () => {
    // A change that lands late -- an answer from the engine -- wrote back the
    // page from when it was asked for.
    insertBlock(WIDGET_BUILDERS.plot_window.create('chart', 'Chart'));
    insertBlock(WIDGET_BUILDERS.text.create('gone', 'Gone'));
    patchBlock('chart', { label: 'Renamed' });
    removeBlock('gone');
    insertBlock(WIDGET_BUILDERS.text.create('added', 'Added'));

    patchBlock('chart', { tone: 'accent' });

    expect(shown().map((w) => [w.id, w.label])).toEqual([['chart', 'Renamed'], ['added', 'Added']]);
    expect(shown()[0].tone).toBe('accent');
  });

  it('is changed here when it is used, too -- on the Page tab, in the running application, in a tool: what it holds already is no undo step', () => {
    // A block used on the page wrote the page's blocks itself, beside this
    // file, and took an undo step for a value the block already held.
    insertBlock({ ...WIDGET_BUILDERS.text_io.create('ask', 'Ask'), value: 'hello' });
    let events: ReturnType<typeof usePageEvents> | undefined;
    function Using() {
      events = usePageEvents();
      return null;
    }
    renderToStaticMarkup(createElement(Using));
    const undo = store().past.length;
    events!.setWidgetValue(shown()[0], 'hello');
    expect(store().past.length).toBe(undo);
    events!.setWidgetValue(shown()[0], 'hello there');
    expect(shown()[0].value).toBe('hello there');
    expect(store().past.length).toBe(undo + 1);
  });

  it('takes what is typed into a block as one undo step, as a node\'s panel does: fifty characters were fifty', () => {
    // Fifty steps pushed the node deleted before them out of the undo history.
    const count = store().addNode('code', { x: 0, y: 0 });
    insertBlock(WIDGET_BUILDERS.chat.create('chat', 'Chat'));
    store().deleteNodes([count]);
    const typed = 'What does this graph count, and where does it look?';
    for (let at = 1; at <= typed.length; at += 1) patchBlock('chat', { value: { messages: [], pending: typed.slice(0, at) } });
    store().undo();
    expect(shown()[0].value).toBeUndefined();
    store().undo();
    expect(store().rfNodes.map((n) => n.id)).toContain(count);
  });

  it('changes nothing when the block was deleted meanwhile: not even an undo step', () => {
    insertBlock(WIDGET_BUILDERS.text.create('a', 'A'));
    const before = JSON.stringify(store().exportGraph());
    const undo = store().past.length;
    patchBlock('chart', { label: 'x' });
    expect(JSON.stringify(store().exportGraph())).toBe(before);
    expect(store().past.length).toBe(undo);
  });

  it('moves a block by place or onto another, and takes the page away with its last one', () => {
    for (const id of ['a', 'b', 'c']) insertBlock({ ...WIDGET_BUILDERS.text.create(id), id });
    moveBlock('c', 0);
    expect(shown().map((w) => w.id)).toEqual(['c', 'a', 'b']);
    moveBlock('c', 'b');
    expect(shown().map((w) => w.id)).toEqual(['a', 'b', 'c']);
    moveBlock('a', 7);
    expect(shown().map((w) => w.id)).toEqual(['a', 'b', 'c']);
    insertBlock(WIDGET_BUILDERS.divider.create('d', ''), 1);
    expect(shown().map((w) => w.id)).toEqual(['a', 'd', 'b', 'c']);
    for (const id of ['a', 'd', 'b', 'c']) removeBlock(id);
    expect(page().page).toBeUndefined();
  });
});
