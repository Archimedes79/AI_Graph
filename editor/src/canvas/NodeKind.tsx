import type { GraphNode } from '@/graph';
import { NODE_BUILDERS } from '@/elements/registry';
import { DIM, LINE, TEXT } from '@/ui/theme';

/**
 * What a node is, said small: its kind as a tag in the kind's own tint, and
 * its id. On the node's card and at the top of its panel alike, so the two
 * read as one thing. The tint is the scheme's background for the kind, which
 * is why the tag's words are the scheme's text colour: readable on every
 * scheme, dark or light.
 */
export default function NodeKind({ node }: { node: GraphNode }) {
  const builder = NODE_BUILDERS[node.node_type];
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span
        className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider leading-4"
        style={{ background: builder?.color ?? LINE, color: TEXT }}
      >
        {builder?.label ?? node.node_type}
      </span>
      <span className="truncate font-mono text-[11px]" style={{ color: DIM }} title={`Its id: ${node.id}`}>
        {node.id}
      </span>
    </span>
  );
}
