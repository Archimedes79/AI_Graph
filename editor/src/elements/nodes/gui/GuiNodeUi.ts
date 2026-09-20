import { lazy } from 'react';
import type { GraphNode, GuiWidget } from '@/graph';
import { NodeUi } from '../../NodeUi';
import { WIDGET_UIS } from '../../widgets/roster';

/** A composite: it holds widgets, generates nothing itself, and emits what its widgets emit. */
export class GuiNodeUi extends NodeUi {
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
    return widgets.some((widget) => WIDGET_UIS[widget.kind]?.missingExample(widget));
  }

  override describeOutput(): string {
    return 'values from its widgets';
  }

}
