import type { NodeChange } from 'reactflow';
import type { GraphNode } from '../types/graph';

/**
 * Which removals to let through, and which to ask about first.
 *
 * Pressing Delete with a gui node selected removes the graph's entire page —
 * every block, every field, every heading — in one keystroke, because to the
 * canvas it is one node like any other. Ctrl+Z brings it back, which is little
 * comfort to someone who has just watched an afternoon's layout vanish.
 *
 * The node's own ✕ already asks when edges would go with it. This is the same
 * question for a larger loss, arriving by a different route. A node with
 * nothing on its page is deleted without ceremony: a confirmation for an empty
 * node is the kind of prompt people learn to click through.
 */
export function removalsToApply(
  changes: NodeChange[],
  nodeById: (id: string) => GraphNode | undefined,
  confirm: (question: string) => boolean,
): NodeChange[] {
  return changes.filter((change) => {
    if (change.type !== 'remove') return true;
    const node = nodeById(change.id);
    const blocks = node?.config.gui_widgets?.length ?? 0;
    if (!blocks) return true;
    return confirm(
      `Delete "${node?.label}"? Its ${blocks} interface ${blocks === 1 ? 'block' : 'blocks'} go with it.`,
    );
  });
}
