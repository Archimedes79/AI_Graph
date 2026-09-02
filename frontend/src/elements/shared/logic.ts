// What an element authors, asked of the engine rather than declared again here.
//
// The editor used to carry its own `authoredFile` per element definition --
// twelve one-line copies of `{ extension, what }` that had to agree with the
// engine's answer and, being a separate list, could stop agreeing without
// anything failing. The engine's element already knows: which config key holds
// the body, which holds the request, and what extension a file of it gets.
//
// Same argument as `guiWidgets.ts` makes for ports, and the same shape: ask the
// registry the graph will actually run against.

import type { GraphNode, GuiWidget } from '../../types/graph';
import type { Logic } from '@engine/logic.ts';
import { registry as engineRegistry } from '@engine/registry.ts';
import { parseWidget } from '@engine/elements/gui/element.ts';

/** What this node authors, or undefined if it authors nothing. */
export function nodeLogic(node: GraphNode): Logic | undefined {
  return engineRegistry.node(node.node_type)?.logic(node as never);
}

/** What this block authors, or undefined if it authors nothing. */
export function widgetLogic(widget: GuiWidget): Logic | undefined {
  const element = engineRegistry.widget(widget.kind);
  return element?.logic(parseWidget(widget));
}

export type { Logic };
