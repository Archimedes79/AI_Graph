import type { NodeChange } from 'reactflow';
import type { GraphNode } from '@/graph';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

/**
 * The keys that delete what is selected on the canvas: Delete and Backspace --
 * while the canvas is the view on screen (*active*), and only as pressed on
 * the canvas itself (*focused*): a node or the empty canvas clicked last. A
 * node's panel is open beside the canvas whenever a node is selected, and a
 * key pressed in it is the panel's; so is one pressed after a button in it
 * went away under the focus -- ✨ Fix, once it has fixed -- which hands the
 * key to the page, where Backspace deleted the node the panel was open on.
 */
export function deleteKeys(active: boolean, focused: boolean): string[] | null {
  return active && focused ? ['Delete', 'Backspace'] : null;
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
