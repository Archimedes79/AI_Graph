import { describe, it, expect } from 'vitest';
import { patchBlock, routePage } from './pageWrite';
import { pageOf } from './GuiPage';
import { baseNodeConfig } from '@/document/baseNodeConfig';
import type { GraphNode, GuiWidget } from '@/graph';
import { WIDGET_BUILDERS } from '@/elements/registry';

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

describe('a block changed after a wait', () => {
  it('changes that block on the page as it is by then, keeping what was added, renamed and deleted meanwhile', () => {
    // Accepting a ✨ result wrote back the page from when ✨ was pressed.
    const chart = { ...WIDGET_BUILDERS.plot_window.create('Chart'), id: 'chart' };
    const added = { ...WIDGET_BUILDERS.text.create('Added'), id: 'added' };
    // Pressed on a page of the chart and a block "gone"; meanwhile the chart
    // was renamed, "gone" deleted, and another block added.
    const now = guiNode('gui1', [{ ...chart, label: 'Renamed' }, added]);
    const page = pageOf([now]);

    const writes = patchBlock(page.guiNodes, page.blocks, 'chart', { code: 'function draw() { return []; }' });

    expect(writes).toHaveLength(1);
    expect(writes[0].widgets.map((w) => [w.id, w.label])).toEqual([['chart', 'Renamed'], ['added', 'Added']]);
    expect(writes[0].widgets[0].code).toBe('function draw() { return []; }');
  });

  it('changes nothing when the block was deleted meanwhile', () => {
    const page = pageOf([guiNode('gui1', [{ ...WIDGET_BUILDERS.text.create('A'), id: 'a' }])]);
    expect(patchBlock(page.guiNodes, page.blocks, 'chart', { label: 'x' })).toEqual([]);
  });
});
