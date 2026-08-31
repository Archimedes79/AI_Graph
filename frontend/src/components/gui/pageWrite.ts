// Turning one page back into the nodes it is stored in.
//
// The page is flat -- a single ordered list of blocks -- while the graph keeps
// those blocks on one or more gui nodes. Every edit on the page (add, reorder,
// delete, retone) therefore ends here, and this is the only place that knows
// which node a block belongs to.
//
// It is a plain function rather than a few lines inside the designer because
// the one bug it ever had was invisible from the outside: with a gui node in
// the graph but nothing on the page yet, new blocks were routed to an owner
// derived from the *existing* blocks, found none, and were dropped without a
// word. The palette was dead for exactly as long as the page was empty -- which
// is the whole time anyone is starting one. A component you cannot call from a
// test hides that; a function does not.
import type { GraphNode, GuiWidget } from '../../types/graph';

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
