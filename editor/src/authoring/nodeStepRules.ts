// What the four steps decide for a node, apart from drawing them.
//
// Kept apart from the component so that what a click does is one function,
// asked the same way by the dialog and by `masterExamples.test.ts`, which
// builds the examples through these steps.

import type { GraphNode, Wire } from '@/graph';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import { asExampleText, readPair, withInput } from './examplePair';

/** What a node hands on, without the executor's own error port: what a body returns, and an example expects. */
export function ownOutputs(outputs: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(outputs ?? {}).filter(([port]) => port !== ERROR_PORT));
}

/**
 * An input typed `list` takes a list whole, whatever else does: a stop-word
 * list beside the words a node runs once per item on. Its type says so, so it
 * never fans out.
 */
const takesListWhole = (port: GraphNode['inputs'][number]): boolean => port.data_type === 'list';

/**
 * The input ports a list arrives on, one at a time when the node runs per
 * item: one whose example value is a list, one declared a list, or one wired
 * from an output that hands on a list -- but not one typed `list`.
 */
export function listPorts(node: GraphNode, example: Record<string, unknown> | undefined, nodes: GraphNode[] = [], edges: Wire[] = []): string[] {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const wiredList = (port: string) => edges.some((edge) => edge.target === node.id && edge.targetHandle === port
    && byId.get(edge.source)?.outputs.find((output) => output.id === edge.sourceHandle)?.multi === true);
  return node.inputs
    .filter((port) => !takesListWhole(port) && (port.multi || Array.isArray(example?.[port.id]) || wiredList(port.id)))
    .map((port) => port.id);
}

/** Whether the node runs once per item of a list: what "Run once per item" shows. */
export function runsPerItem(node: GraphNode): boolean {
  return node.config.batch_mode === 'per_item' && node.inputs.some((port) => port.multi);
}

/**
 * *node*, told to run once per item of the lists that arrive, or once on
 * them whole: `batch_mode` and the inputs that fan out, set together, because
 * either one alone does nothing -- per item with no input declared a list runs
 * once on everything, and a list input on a whole-list node is handed whole.
 * Per item, the inputs *lists* names fan out (every one not typed `list`,
 * when it names none yet: what arrives is not known before it has); whole,
 * none do.
 */
export function withPerItem(node: GraphNode, perItem: boolean, lists: string[] = []): GraphNode {
  const fans = (port: GraphNode['inputs'][number]) => perItem && (lists.length ? lists.includes(port.id) : !takesListWhole(port));
  return {
    ...node,
    config: { ...node.config, batch_mode: perItem ? 'per_item' : 'whole_list' },
    inputs: node.inputs.map((port) => (port.multi === fans(port) ? port : { ...port, multi: fans(port) })),
  };
}

/**
 * What ▶ Try it runs *node* on: step 1's *example*, or undefined while there
 * is none. A node with no inputs -- one that makes its data rather than
 * taking it -- is run on nothing: there is no example to fill, and neither
 * way of filling one has anything to fill it with.
 */
export function tryInputs(node: GraphNode, example: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return example ?? (node.inputs.length ? undefined : {});
}

/**
 * *examples* ready for step 2 to write a check into. A node with no inputs is
 * run on nothing (`tryInputs`), and has no box to type that into, so its
 * example's input is `{}` from the first check on. A node with inputs waits
 * for step 1: an expectation written before it stands alone, and nothing is
 * run on it until there is an input to run it on.
 */
export function exampleFor(node: GraphNode, examples: string): string {
  return node.inputs.length || readPair(examples).inputText.trim() ? examples : withInput(examples, '{}');
}

/**
 * What came out of a try, as step 2's expected output: every output the node
 * hands on, as JSON -- what `test` then holds each later version to. Trimming
 * it to the fields that matter is the person's to do.
 */
export function keptExpect(outputs: Record<string, unknown> | undefined): string {
  return asExampleText(ownOutputs(outputs));
}
