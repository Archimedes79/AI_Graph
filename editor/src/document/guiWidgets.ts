// Keeping a gui node's ports in step with its blocks.
//
// The ports come from the **engine's** widget elements, not from a copy here.
// They are what the graph's edges attach to, so two answers to "which ports
// does this block have" is the one disagreement that silently deletes wires:
// the editor drawing a port the engine will not produce, or the engine
// producing one the editor never drew.
import type { GraphNode, GuiWidget, NodeResult, Port } from '@/graph';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { parseWidget } from '@engine/elements/nodes/gui/GuiNodeRunner.ts';

/**
 * The ports a node has, when they follow from its settings rather than being
 * named by hand.
 *
 * Null for a code, AI, data or output node: a person names those to match the
 * code they wrote or the prompt they gave, so the graph is the authority and
 * an element declaring `input` and `value` for them would invent a contract
 * nobody agreed to. Input and gui nodes are the other kind, and this is the
 * only place either is worked out.
 */
export function derivedNodePorts(node: GraphNode): { inputs: Port[]; outputs: Port[] } | null {
  const element = engineRegistry.node(node.node_type);
  return (element?.derivedPorts(node as never, engineRegistry as never) ?? null) as { inputs: Port[]; outputs: Port[] } | null;
}

/** Return the (inputs, outputs) a single GUI widget contributes to its node. */
export function guiWidgetPorts(widget: GuiWidget): { inputs: Port[]; outputs: Port[] } {
  const element = engineRegistry.widget(widget.kind);
  if (!element) return { inputs: [], outputs: [] };
  // `parseWidget` is what turns a stored block into the shape an element reads:
  // its structural fields, and everything else as settings the element owns.
  return element.ports(parseWidget(widget)) as { inputs: Port[]; outputs: Port[] };
}

/**
 * The block one of a gui node's ports belongs to.
 *
 * A gui node's ports are named after the block that contributes them
 * (`syncGuiNodePorts` below), and this is where that naming is read back --
 * once, rather than spelled out wherever the canvas wants to know what is
 * behind a port.
 */
export function widgetOfPort(node: GraphNode, portId: string): GuiWidget | undefined {
  return node.config.gui_widgets.find((w) => `${w.id}_in` === portId || `${w.id}_out` === portId);
}

/**
 * What a run put on one block of the page that is *result*: the engine's
 * `display`, which is what arrived as the block draws it -- an image's path
 * read into the picture. A block that also hands something on -- a chat, a
 * box that is typed into and shows -- is no display, and shows what arrived
 * on its port. The page and the page's node on the canvas both ask here.
 */
export function blockShows(result: NodeResult | undefined, widgetId: string): unknown {
  const shown = result?.display?.[widgetId];
  return shown !== undefined ? shown : result?.inputs?.[`${widgetId}_in`];
}

/**
 * Whether this kind of node carries the graph's interface — the engine's
 * answer, not a second flag beside it.
 *
 * The editor kept its own `NodeGuiBuilder.hasRuntimeWindow` saying the same thing, and
 * nothing checked that the two agreed. The one that decides what the page is
 * *made of* is the engine's: it is what `display` is asked of and what a
 * bundle carries a page for.
 */
export function showsPage(nodeType: string): boolean {
  return engineRegistry.node(nodeType)?.hasInterface === true;
}

/**
 * Whether using this block starts the graph -- the engine's answer, for the
 * same reason the ports are: a page that fires on something the engine would
 * not call an event starts runs nobody wired.
 */
export function widgetFiresRun(widget: GuiWidget): boolean {
  const element = engineRegistry.widget(widget.kind);
  return element ? element.firesRun(parseWidget(widget)) : false;
}

/**
 * Regenerate a GUI/WIDGET node's inputs/outputs strictly from
 * `config.gui_widgets`, in order. No-op (returns the node unchanged) for any
 * other node type. Call this after any widget-list edit instead of
 * hand-editing `inputs`/`outputs` directly -- widget ids never change, so
 * port ids (`${id}_in` / `${id}_out`) stay stable across re-syncs and
 * existing edges remain attached. A WIDGET node is just a GUI node whose
 * `gui_widgets` holds exactly one widget -- same derivation.
 *
 * The page's ports are the engine's answer (`GuiNodeRunner.derivedPorts`),
 * the same one a load gets. This used to add the blocks' own ports up here,
 * and a block told to catch its failures has one more -- `<id>_error`, which
 * the engine adds and the sum here did not. So ticking "catch" grew no port
 * until the next load, and once it was there and wired, the next edit of any
 * block on the page dropped it again and `updateNode` pruned its wire.
 */
export function syncGuiNodePorts(node: GraphNode): GraphNode {
  if (!showsPage(node.node_type)) return node;
  const derived = derivedNodePorts(node);
  return derived ? { ...node, inputs: derived.inputs, outputs: derived.outputs } : node;
}
