import { describe, it, expect, beforeEach } from 'vitest';
import { insertBlock, moveBlock, patchBlock, removeBlock, routePage } from './pageWrite';
import { pageOf } from './GuiPage';
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

describe('routePage', () => {
  it('gives the first block to a gui node that is still empty', () => {
    // The regression: the owner set used to come from the blocks already on the
    // page. With an empty gui node there were none, every new widget resolved
    // to no owner, and adding one -- by click or by drag -- silently did
    // nothing. Dead palette, no error, and only while the page was empty.
    const node = guiNode('gui1', []);
    const added = WIDGET_BUILDERS.text.create('Title', 'heading');

    const writes = routePage([node], [], [added]);

    expect(writes).toHaveLength(1);
    expect(writes[0].node.id).toBe('gui1');
    expect(writes[0].widgets.map((w) => w.id)).toEqual([added.id]);
  });

  it('keeps every block on the node that already stores it', () => {
    const a = WIDGET_BUILDERS.text.create('A');
    const b = WIDGET_BUILDERS.text.create('B');
    const first = guiNode('gui1', [a]);
    const second = guiNode('gui2', [b]);
    const blocks = [{ node: first, widget: a }, { node: second, widget: b }];

    // Reordered across nodes: B before A on the page, both staying put.
    const writes = routePage([first, second], blocks, [b, a]);

    expect(writes).toEqual([]);
  });

  it('inserts a new block on the first node without moving the others', () => {
    const a = WIDGET_BUILDERS.text.create('A');
    const b = WIDGET_BUILDERS.text.create('B');
    const first = guiNode('gui1', [a]);
    const second = guiNode('gui2', [b]);
    const blocks = [{ node: first, widget: a }, { node: second, widget: b }];
    const added = WIDGET_BUILDERS.divider.create('');

    const writes = routePage([first, second], blocks, [added, a, b]);

    expect(writes).toHaveLength(1);
    expect(writes[0].node.id).toBe('gui1');
    expect(writes[0].widgets.map((w) => w.id)).toEqual([added.id, a.id]);
  });

  it('writes the emptied node when its last block is deleted', () => {
    const a = WIDGET_BUILDERS.text.create('A');
    const node = guiNode('gui1', [a]);

    const writes = routePage([node], [{ node, widget: a }], []);

    expect(writes).toHaveLength(1);
    expect(writes[0].widgets).toEqual([]);
  });

  it('drops nothing on the floor when there is no gui node at all', () => {
    // The caller creates one in this case; returning an empty list is how it
    // finds out, and is the only situation where a widget may go unwritten.
    expect(routePage([], [], [WIDGET_BUILDERS.text.create('A')])).toEqual([]);
  });
});

// ── Changing the page as the store holds it ────────────────────────────────

const store = () => useGraphStore.getState();
const page = () => pageOf(store().rfNodes.map((n) => n.data.graphNode as GraphNode));
const shown = () => page().blocks.map((b) => b.widget);

describe('a block edited on the page', () => {
  beforeEach(() => store().newGraph());

  it('keeps the keystroke that made a heading grow: the text and the height land together (B31)', () => {
    // A box that grows as it is typed into changes its block twice in one
    // keystroke: the text, then the height. The height was written onto the
    // page as it had been drawn, and put the text back from before the key.
    insertBlock({ ...WIDGET_BUILDERS.text.create('', 'heading'), id: 'text', value: 'Hel', w: 16, h: 1 });
    const undo = store().past.length;
    patchBlock('text', { value: 'Hell' });
    patchBlock('text', { h: 2 });
    expect(shown()[0]).toMatchObject({ value: 'Hell', h: 2 });
    expect(store().past.length).toBe(undo + 2);
  });

  it('changes a block on the page as it is by then, keeping what was added, renamed and deleted meanwhile', () => {
    // Accepting a ✨ result wrote back the page from when ✨ was pressed.
    insertBlock({ ...WIDGET_BUILDERS.plot_window.create('Chart'), id: 'chart' });
    insertBlock({ ...WIDGET_BUILDERS.text.create('Gone'), id: 'gone' });
    patchBlock('chart', { label: 'Renamed' });
    removeBlock('gone');
    insertBlock({ ...WIDGET_BUILDERS.text.create('Added'), id: 'added' });

    patchBlock('chart', { code: 'function draw() { return []; }' });

    expect(shown().map((w) => [w.id, w.label])).toEqual([['chart', 'Renamed'], ['added', 'Added']]);
    expect(shown()[0].code).toBe('function draw() { return []; }');
  });

  it('changes nothing when the block was deleted meanwhile', () => {
    insertBlock({ ...WIDGET_BUILDERS.text.create('A'), id: 'a' });
    const before = JSON.stringify(store().exportGraph());
    patchBlock('chart', { label: 'x' });
    expect(JSON.stringify(store().exportGraph())).toBe(before);
  });

  it('makes the page\'s node for the first block, and moves a block by place or onto another', () => {
    for (const id of ['a', 'b', 'c']) insertBlock({ ...WIDGET_BUILDERS.text.create(id), id });
    expect(page().guiNodes).toHaveLength(1);
    moveBlock('c', 0);
    expect(shown().map((w) => w.id)).toEqual(['c', 'a', 'b']);
    moveBlock('c', 'b');
    expect(shown().map((w) => w.id)).toEqual(['a', 'b', 'c']);
    moveBlock('a', 7);
    expect(shown().map((w) => w.id)).toEqual(['a', 'b', 'c']);
    insertBlock({ ...WIDGET_BUILDERS.divider.create(''), id: 'd' }, 1);
    expect(shown().map((w) => w.id)).toEqual(['a', 'd', 'b', 'c']);
  });
});

