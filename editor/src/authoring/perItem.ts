// "Run once per item", and "whole list" beside it: how a node takes the lists
// that arrive, set on its ports and its settings together.
//
// Kept apart from the components that draw the boxes, so what a click does is
// one function, asked the same way by the node's Advanced settings, its ports
// editor and `masterExamples.test.ts`, which builds the examples by these rules.

import type { GraphNode, Port, Wire } from '@/graph';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import { runsPerItem as engineRunsPerItem } from '@engine/execution/batching.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';

/**
 * An input ticked "whole list" takes a list whole, whatever else does: a
 * stop-word list beside the words a node runs once per item on. The tick types
 * it `list` (`wholeList`), so it never fans out.
 */
const takesListWhole = (port: Port): boolean => port.data_type === 'list';

/**
 * *port* handed its list whole ("whole list", while the node runs once per
 * item) -- or, *whole* false, one item at a time again. Whole, it is typed
 * `list` too: that is how it stays whole when "Run once per item" is ticked
 * again (`withPerItem`), what `check` holds a wire into it to, and what ✨ is
 * told it is handed. An input that reads its files keeps that type, and is
 * only not fanned out.
 */
export function wholeList(port: Port, whole: boolean): Port {
  if (whole) return { ...port, multi: false, ...(port.data_type === 'file_path' ? {} : { data_type: 'list' as const }) };
  return { ...port, multi: true, ...(takesListWhole(port) ? { data_type: 'any' as const } : {}) };
}

/**
 * The input ports a list arrives on, one at a time when the node runs per
 * item: one whose example value (in input.js) is a list, one declared a list,
 * or one wired from an output that hands on a list -- but not one ticked
 * "whole list".
 */
export function listPorts(node: GraphNode, example: Record<string, unknown> | undefined, nodes: GraphNode[] = [], edges: Wire[] = []): string[] {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const wiredList = (port: string) => edges.some((edge) => edge.target === node.id && edge.targetHandle === port
    && byId.get(edge.source)?.outputs.find((output) => output.id === edge.sourceHandle)?.multi === true);
  return node.inputs
    .filter((port) => !takesListWhole(port) && (port.multi || Array.isArray(example?.[port.id]) || wiredList(port.id)))
    .map((port) => port.id);
}

/**
 * Whether the node runs once per item of a list: what "Run once per item"
 * shows. The engine's answer (`execution/batching.ts`), asked of the node's
 * element -- a kind that takes what arrives whole does so whatever its
 * setting says.
 */
export function runsPerItem(node: GraphNode): boolean {
  const element = engineRegistry.node(node.node_type);
  return !!element && engineRunsPerItem(node, element.batchMode(node));
}

/**
 * *node*, told to run once per item of the lists that arrive, or once on
 * them whole: `batch_mode`, the inputs that fan out and the outputs that hand
 * on a list, set together, because none of them does anything alone -- per
 * item with no input declared a list runs once on everything, and a list
 * input on a whole-list node is handed whole. Per item, the inputs *lists*
 * names fan out (every one not ticked "whole list", when it names none yet:
 * what arrives is not known before it has); whole, none do. And a list follows:
 * per item, every output hands on the list of the answers, and the node it
 * feeds is told so; whole, none says it does.
 */
export function withPerItem(node: GraphNode, perItem: boolean, lists: string[] = []): GraphNode {
  const fans = (port: GraphNode['inputs'][number]) => perItem && (lists.length ? lists.includes(port.id) : !takesListWhole(port));
  return {
    ...node,
    config: { ...node.config, batch_mode: perItem ? 'per_item' : 'whole_list' },
    inputs: node.inputs.map((port) => (port.multi === fans(port) ? port : { ...port, multi: fans(port) })),
    // The error port says why, once, whatever the node runs on.
    outputs: node.outputs.map((port) => (port.id === ERROR_PORT || port.multi === perItem ? port : { ...port, multi: perItem })),
  };
}
