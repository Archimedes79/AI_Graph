import type { NodeChange } from 'reactflow';
import type { GraphNode } from '@/graph';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

/**
 * The keys that delete what is selected on the canvas: Delete and Backspace --
 * while the canvas is the view on screen (*active*), and no node's dialog is
 * open over it (*editing*). A key pressed inside any dialog is the dialog's,
 * and says so to ReactFlow (`Modal`'s `nokey`); but a button that goes away
 * under the focus -- ✨ Fix, once it has fixed -- hands the key to the page,
 * and Backspace deleted the node the dialog was open on, behind it.
 */
export function deleteKeys(active: boolean, editing: boolean): string[] | null {
  return active && !editing ? ['Delete', 'Backspace'] : null;
}

/**
 * Which removals to let through, and which to ask about first.
 *
 * Pressing Delete with the page's node selected removes the graph's entire
 * page — every block, every field, every heading — in one keystroke, because
 * to the canvas it is one node like any other. Ctrl+Z brings it back, which is
 * little comfort to someone who has just watched an afternoon's layout vanish.
 *
 * The node's own ✕ already asks when edges would go with it. This is the same
 * question for a larger loss, arriving by a different route. A page with
 * nothing on it is deleted without ceremony: a confirmation for an empty
 * node is the kind of prompt people learn to click through. Which blocks a
 * node holds is the element's to say (`NodeRunner.blocks`).
 */
export function removalsToApply(
  changes: NodeChange[],
  nodeById: (id: string) => GraphNode | undefined,
  confirm: (question: string) => boolean,
): NodeChange[] {
  return changes.filter((change) => {
    if (change.type !== 'remove') return true;
    const node = nodeById(change.id);
    const blocks = node ? engineRegistry.node(node.node_type)?.blocks(node).length ?? 0 : 0;
    if (!blocks) return true;
    return confirm(`Delete the page? Its ${blocks} ${blocks === 1 ? 'block goes' : 'blocks go'} with it.`);
  });
}
