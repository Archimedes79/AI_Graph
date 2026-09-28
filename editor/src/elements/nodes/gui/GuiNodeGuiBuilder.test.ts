import { describe, it, expect } from 'vitest';
import type { GraphNode, GuiWidget } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { syncGuiNodePorts } from '@/document/guiWidgets';
import { NODE_BUILDERS, WIDGET_BUILDERS } from '@/elements/registry';

function page(widget: GuiWidget): GraphNode {
  const blank = NODE_KINDS.gui.create('page');
  return syncGuiNodePorts({ ...blank, label: 'Page', config: { ...blank.config, gui_widgets: [widget] } });
}

/**
 * What a node wired into a block is told to hand it (`wantsOn`): what goes
 * into that node's ✨ as where its output goes.
 */
describe('what a block on a page asks of the node wired into it', () => {
  it('is what its kind draws', () => {
    const table = WIDGET_BUILDERS.table.create('rows', 'Rows');
    expect(NODE_BUILDERS.gui.wantsOn(page(table), 'rows_in')).toContain('column header');
  });

  it('is what its kind draws for every drawing block: a block reshapes nothing', () => {
    for (const kind of ['plot_window', 'table', 'image_view'] as const) {
      const block = WIDGET_BUILDERS[kind].create('block', 'Block');
      expect(NODE_BUILDERS.gui.wantsOn(page(block), 'block_in'), kind).toBeTruthy();
    }
  });
});

/**
 * Then where the block shows it, which the node wired into it cannot know and
 * the editor can: its size on the page at full width, from its cells, and its
 * text as its kind draws it -- so a title can be written to fit, and SVG at the
 * size it will be drawn.
 */
describe('where a block on a page shows what arrives', () => {
  it('is a chart\'s size and the sizes it draws its labels and title at', () => {
    const chart = { ...WIDGET_BUILDERS.plot_window.create('sizes', 'Sizes'), w: 16, h: 9 };
    expect(NODE_BUILDERS.gui.wantsOn(page(chart), 'sizes_in'))
      .toMatch(/which the chart draws at the block's real size .* shown as it stands; shown at about 1106 x 616 px \(16 x 9 cells\), labels 11 px, title 13 px$/);
  });

  it('is a table\'s rows, at the default span for a block with no size of its own', () => {
    const table: GuiWidget = { id: 'rows', kind: 'table', label: 'Rows', tone: 'plain' };
    expect(NODE_BUILDERS.gui.wantsOn(page(table), 'rows_in'))
      .toMatch(/whose first row is the header; shown at about 546 x 266 px \(8 x 4 cells\), 12 px rows$/);
  });

  it('is a text box\'s text first: it takes anything, and this is read after "which wants"', () => {
    const box = { ...WIDGET_BUILDERS.text_io.create('answer', 'Answer', 'output'), w: 8, h: 5 };
    expect(NODE_BUILDERS.gui.wantsOn(page(box), 'answer_in'))
      .toBe('14 px text that wraps and scrolls, shown at about 546 x 336 px (8 x 5 cells)');
  });
});
