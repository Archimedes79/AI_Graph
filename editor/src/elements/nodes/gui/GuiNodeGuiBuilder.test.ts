import { describe, it, expect } from 'vitest';
import type { GraphNode, GuiWidget } from '@/graph';
import { NODE_KINDS } from '@/document/nodeKinds';
import { syncGuiNodePorts } from '@/document/guiWidgets';
import { NODE_BUILDERS, WIDGET_BUILDERS } from '@/elements/registry';

function page(widget: GuiWidget): GraphNode {
  const blank = NODE_KINDS.gui.create('page');
  return syncGuiNodePorts({ ...blank, label: 'Page', config: { ...blank.config, gui_widgets: [widget] } });
}

const DRAWING_BLOCKS = ['plot_window', 'table', 'image_view'] as const;

/**
 * What a node wired into a block is told to hand it (`wantsOn`,
 * `describeAsTarget`): what goes into that node's ✨ as where its output goes.
 */
describe('what a block on a page asks of the node wired into it', () => {
  it('is what its kind draws, while it has no code of its own', () => {
    const table = { ...WIDGET_BUILDERS.table.create('Rows'), id: 'rows' };
    expect(NODE_BUILDERS.gui.wantsOn(page(table), 'rows_in')).toContain('column header');
    expect(NODE_BUILDERS.gui.describeAsTarget(page(table), 'rows_in')).toContain('It wants rows');
  });

  it('is nothing to pre-shape once its own code reads what arrives', () => {
    // The bug: the element was handed the block as the editor stores it, with
    // its code beside its name rather than under `config`, found no code, and
    // told the node feeding a chart whose draw() reads rows to send it points.
    for (const kind of DRAWING_BLOCKS) {
      const block = { ...WIDGET_BUILDERS[kind].create('Block'), id: 'block', code: 'function run(inputs) { return { value: inputs.value.rows }; }' };
      expect(NODE_BUILDERS.gui.wantsOn(page(block), 'block_in'), kind).toBeUndefined();
      expect(NODE_BUILDERS.gui.describeAsTarget(page(block), 'block_in'), kind).not.toContain('It wants');
    }
  });
});
