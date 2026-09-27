import type { NodeChange } from 'reactflow';
import type { GraphNode } from '@/graph';

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
 * node is the kind of prompt people learn to click through.
 */
export function removalsToApply(
  changes: NodeChange[],
  nodeById: (id: string) => GraphNode | undefined,
  confirm: (question: string) => boolean,
): NodeChange[] {
  return changes.filter((change) => {
    if (change.type !== 'remove') return true;
    const blocks = nodeById(change.id)?.config.gui_widgets?.length ?? 0;
    if (!blocks) return true;
    return confirm(`Delete the page? Its ${blocks} ${blocks === 1 ? 'block goes' : 'blocks go'} with it.`);
  });
}
