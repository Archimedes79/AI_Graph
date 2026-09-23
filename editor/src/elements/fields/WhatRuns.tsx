import type { GraphNode } from '@/graph';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { DIMMER, LINE, MUTED } from '@/ui/theme';

/**
 * What runs when this node runs: the file in its folder, or the engine class
 * that does the work, and in one sentence what that is.
 *
 * Asked of the engine's element (`whatRuns`), so the panel, the node's
 * `interface.json` and the documentation say the same thing in the same words.
 */
export default function WhatRuns({ node, folded }: { node: GraphNode; folded?: boolean }) {
  const runs = engineRegistry.node(node.node_type)?.whatRuns(node as never);
  if (!runs?.does) return null;
  if (folded) {
    return (
      <details className="rounded-lg" style={{ border: `1px solid ${LINE}` }}>
        <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
          What runs, technically
        </summary>
        <div className="px-3 pb-3"><WhatRuns node={node} /></div>
      </details>
    );
  }
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ border: `1px solid ${LINE}` }}>
      <div className="font-medium" style={{ color: MUTED }}>
        What this node runs{' '}
        <span style={{ color: DIMMER }}>
          — <code>{runs.where}</code>{runs.by === 'body' ? ', in a sandboxed process of its own' : ', in the engine'}
        </span>
      </div>
      <p className="mt-1" style={{ color: DIMMER }}>{runs.does}</p>
    </div>
  );
}
