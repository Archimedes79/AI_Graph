import type { GraphNode, GuiWidget, NodeResult } from '@/graph';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';
import { WIDGET_BUILDERS } from '../../widgets/roster';
import type { PortPreviews } from '../../resultPreview';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { parseWidget } from '@engine/elements/nodes/gui/GuiNodeRunner.ts';
import { blockShows, widgetOfPort } from '@/document/guiWidgets';
import { blockSize } from '@/document/layout';

/** What *widget* wants handed to it, asked of the engine's element with the block as the engine holds one. */
function receives(widget: GuiWidget): string | undefined {
  return engineRegistry.widget(widget.kind)?.receives(parseWidget(widget));
}

/**
 * The page: it holds blocks, generates nothing itself, and emits what its blocks emit.
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

  readonly label = 'Page';

  readonly hint = 'The page this tool shows: its blocks, built on the Page tab';

  readonly icon = '🖥️';

  readonly color = 'var(--ui-node-gui, #4a1d3a)';

  // No Panel: the page is edited on the Page tab, under the graph's name and
  // description (`PageHeading`), and no panel is opened for it
  // (App.tsx). It has no name of its own to give: the tool's is the graph's.

  /**
   * Asked block by block, not of the node: a page with an unfilled picker
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
   *
   * Then where it is shown, which only the editor can say, since it owns the
   * grid: the block's size on the page at full width, and its text as its kind
   * draws it -- so the node can write a title that fits, a summary for the room
   * there is, or its own SVG at the size it will be drawn. A block that takes
   * anything, a text box, says its text first, since this is read after
   * "which wants".
   */
  override wantsOn(node: GraphNode, port: string): string | undefined {
    const widget = widgetOfPort(node, port);
    if (!widget) return super.wantsOn(node, port);
    const { w, h, width, height } = blockSize(widget);
    const size = `shown at about ${width} x ${height} px (${w} x ${h} cells)`;
    const text = WIDGET_BUILDERS[widget.kind]?.textShown();
    const wants = receives(widget)?.trim().replace(/\.$/, '');
    return wants ? `${wants}; ${[size, text].filter(Boolean).join(', ')}` : [text, size].filter(Boolean).join(', ');
  }

  /**
   * What a block hands on before anything has run: the file a picker is set
   * to, the text typed into a box. What a folder picker lists, a run lists.
   */
  override restingValue(node: GraphNode, port: string): unknown {
    const widget = widgetOfPort(node, port);
    if (!widget || widget.mode === 'directory' || port !== `${widget.id}_out`) return undefined;
    return typeof widget.value === 'string' && widget.value.trim() ? widget.value : undefined;
  }

  override describeOutput(): string {
    return 'values from its blocks';
  }

  /**
   * What the page shows, under the port each block is fed on, read by the
   * block: a chart's points are a chart, a picture is a picture. What its
   * blocks hand on -- a typed text, a chosen file -- is on the page itself.
   */
  override resultPreviews(node: GraphNode, result: NodeResult): PortPreviews {
    const inputs: PortPreviews['inputs'] = {};
    for (const port of node.inputs) {
      const block = widgetOfPort(node, port.id);
      const preview = block && WIDGET_BUILDERS[block.kind]?.preview(blockShows(result, block.id));
      if (preview) inputs[port.id] = preview;
    }
    return { inputs, outputs: {} };
  }
}
