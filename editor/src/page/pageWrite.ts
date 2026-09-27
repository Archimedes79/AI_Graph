// Changing the page: the one way a block is added, changed, moved or removed.
//
// The page is flat -- a single ordered list of blocks -- while the graph keeps
// those blocks on one or more gui nodes. Every edit on the page therefore ends
// here, and this is the only place that knows which node a block belongs to.
//
// Each edit reads the page from the store when it lands, never from what a
// component drew. A box that grows as it is typed into changes its block twice
// in one keystroke -- the text, then the height -- and the second change,
// made on the page as it was drawn, put back the text from before the first:
// the character that made the box grow was lost. A ✨ result accepted a minute
// after it was asked for did the same to every edit made meanwhile.
//
// The designer's surface, its side panel and `masterExamples.test.ts`, which
// builds the examples the way a person does, all call these functions.
import type { GraphNode, GuiWidget } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { syncGuiNodePorts } from '@/document/guiWidgets';
import { pageOf } from './GuiPage';

/** A block on the page, and the node that stores it. */
export interface OwnedBlock {
  node: GraphNode;
  widget: GuiWidget;
}

/** One node's new widget list. Only nodes that actually changed are returned. */
export interface PageWrite {
  node: GraphNode;
  widgets: GuiWidget[];
}

/**
 * Route the page's blocks back to their nodes.
 *
 * @param guiNodes  every node that can hold blocks, in graph order. The
 *                  candidates are these -- *not* the nodes the current blocks
 *                  happen to sit on -- so a gui node that is still empty can
 *                  receive the first one.
 * @param blocks    the page as it stands, used to look up each block's owner.
 * @param next      the page as it should be.
 *
 * A block keeps its owner: reordering rearranges the page, it does not move a
 * widget between nodes. Moving one would silently move a port to a different
 * node and take its edges with it -- more than a drag should ever mean. A block
 * that has no owner yet (one just added) goes to the first gui node.
 */
export function routePage(
  guiNodes: GraphNode[],
  blocks: OwnedBlock[],
  next: GuiWidget[],
): PageWrite[] {
  if (guiNodes.length === 0) return [];

  const ownerOf = new Map(blocks.map((b) => [b.widget.id, b.node.id]));
  const byNode = new Map<string, GuiWidget[]>();
  for (const widget of next) {
    const ownerId = ownerOf.get(widget.id) ?? guiNodes[0].id;
    byNode.set(ownerId, [...(byNode.get(ownerId) ?? []), widget]);
  }

  return guiNodes
    .map((node) => ({ node, widgets: byNode.get(node.id) ?? [] }))
    // Unchanged nodes are left alone, so a page edit marks one node dirty
    // rather than every gui node in the graph.
    .filter(({ node, widgets }) => JSON.stringify(widgets) !== JSON.stringify(node.config.gui_widgets));
}

/** The page as the store holds it now. */
function pageNow() {
  return pageOf(useGraphStore.getState().rfNodes.map((n) => n.data.graphNode as GraphNode));
}

/** The page as the store holds it now, rewritten by *edit* and stored back on its nodes. */
function rewrite(edit: (widgets: GuiWidget[]) => GuiWidget[]): void {
  const { guiNodes, blocks } = pageNow();
  for (const { node, widgets } of routePage(guiNodes, blocks, edit(blocks.map((b) => b.widget)))) {
    useGraphStore.getState().updateNode(node.id, syncGuiNodePorts({ ...node, config: { ...node.config, gui_widgets: widgets } }));
  }
}

/** Give block *widgetId* *patch*. Nothing, when the block is no longer there. */
export function patchBlock(widgetId: string, patch: Partial<GuiWidget>): void {
  rewrite((widgets) => widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)));
}

/**
 * Put block *widgetId* at place *to* on the page -- or, *to* being a block's
 * id, where that block stands now, which is what a drag onto it means.
 * Nothing, for a place that is not there.
 */
export function moveBlock(widgetId: string, to: number | string): void {
  rewrite((widgets) => {
    const from = widgets.findIndex((w) => w.id === widgetId);
    const at = typeof to === 'string' ? widgets.findIndex((w) => w.id === to) : to;
    if (from === -1 || at < 0 || at >= widgets.length || from === at) return widgets;
    const next = [...widgets];
    const [moved] = next.splice(from, 1);
    next.splice(at, 0, moved);
    return next;
  });
}

/** Take block *widgetId* off the page. */
export function removeBlock(widgetId: string): void {
  rewrite((widgets) => widgets.filter((w) => w.id !== widgetId));
}

/**
 * Put *widget* on the page at place *at*, at the end without one -- the order
 * is the position. With no gui node in the graph yet, one is made to hold it:
 * the page is the thing being built, and that it needs a node behind it is
 * bookkeeping.
 */
export function insertBlock(widget: GuiWidget, at?: number): void {
  if (!pageNow().guiNodes.length) useGraphStore.getState().addNode('gui', { x: 240, y: 160 });
  rewrite((widgets) => {
    const next = [...widgets];
    next.splice(at ?? next.length, 0, widget);
    return next;
  });
}
