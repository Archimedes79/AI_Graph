import { lazy } from 'react';
import type { GraphNode, GuiWidget } from '@/graph';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { WIDGET_BUILDERS } from '../../widgets/roster';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { widgetOfPort } from '@/document/guiWidgets';

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

  /**
   * Which block the wire lands on, and what that block wants: a chart takes
   * points to plot, a table rows whose keys become columns. The block says so
   * itself (`WidgetRunner.receives`); the node only finds which block it is.
   */
  override describeAsTarget(node: GraphNode, port?: string): string {
    const widget = port ? widgetOfPort(node, port) : undefined;
    if (!widget) return super.describeAsTarget(node, port);
    const wants = engineRegistry.widget(widget.kind)?.receives(widget as never);
    const where = `Output goes to the "${widget.label || widget.kind}" block (${widget.kind}) on the page "${node.label}".`;
    return wants ? `${where} It wants ${wants}` : where;
  }

  override wantsOn(node: GraphNode, port: string): string | undefined {
    const widget = widgetOfPort(node, port);
    return widget ? engineRegistry.widget(widget.kind)?.receives(widget as never) : super.wantsOn(node, port);
  }

  override describeOutput(): string {
    return 'values from its widgets';
  }

}
