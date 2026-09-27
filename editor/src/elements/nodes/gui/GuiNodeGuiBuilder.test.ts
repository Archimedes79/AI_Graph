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
    const table = { ...WIDGET_BUILDERS.table.create('Rows'), id: 'rows' };
    expect(NODE_BUILDERS.gui.wantsOn(page(table), 'rows_in')).toContain('column header');
  });

  it('is what its kind draws for every drawing block: a block reshapes nothing', () => {
    for (const kind of ['plot_window', 'table', 'image_view'] as const) {
      const block = { ...WIDGET_BUILDERS[kind].create('Block'), id: 'block' };
      expect(NODE_BUILDERS.gui.wantsOn(page(block), 'block_in'), kind).toBeTruthy();
    }
  });
});
