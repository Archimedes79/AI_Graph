// What a node authors, asked of the engine rather than declared again here.
//
// The editor used to carry its own `authoredFile` per element definition --
// twelve one-line copies of `{ extension, what }` that had to agree with the
// engine's answer and, being a separate list, could stop agreeing without
// anything failing. The engine's element already knows: which config key holds
// the body, which holds the request, and what extension a file of it gets.
//
// Same argument as `guiWidgets.ts` makes for ports, and the same shape: ask the
// registry the graph will actually run against.

import type { GraphNode } from '@/graph';
import type { Logic } from '@engine/authoring/logic.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

/** What this node authors, or undefined if it authors nothing. */
export function nodeLogic(node: GraphNode): Logic | undefined {
  return engineRegistry.node(node.node_type)?.logic(node as never);
}

export type { Logic };
