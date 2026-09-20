import { lazy } from 'react';
import type { GraphNode, GuiWidget } from '@/graph';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { WIDGET_BUILDERS } from '../../widgets/roster';

/**
 * A composite: it holds widgets, generates nothing itself, and emits what its widgets emit.
 *
 * The doubled word is not a slip. The node type is `gui`, so its runner is
 * `GuiNodeRunner` and its build-time half is that node's `GuiBuilder` --
 * `GuiNodeGuiBuilder`, the one name in the family that reads worse than it
 * means. Spelling it any other way would break the rule that a node type's two
 * halves are its PascalCase name plus the suffix, which `symmetry.test.ts`
 * checks by building both names from the type.
 */
export class GuiNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'gui';


  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'GUI Node';

  readonly hint = 'Give the graph its own interface, built from widgets';

  readonly icon = '🖥️';

  readonly color = 'var(--ui-node-gui, #4a1d3a)';

  override readonly holdsWidgets = true;

  override readonly outputContract = 'widgets';

  override readonly Panel = lazy(() => import('./GuiNodePanel'));

  /**
   * Asked widget by widget, not of the node: a page with an unfilled picker
   * beside a fed text box is still a guess at the picker.
   */
  override missingExample(node: GraphNode): boolean {
    const widgets: GuiWidget[] = Array.isArray(node.config.gui_widgets) ? node.config.gui_widgets : [];
    return widgets.some((widget) => WIDGET_BUILDERS[widget.kind]?.missingExample(widget));
  }

  override describeOutput(): string {
    return 'values from its widgets';
  }

}
