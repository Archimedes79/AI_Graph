// What the four steps decide for a node, apart from drawing them.
//
// Kept apart from the component so that what a click does is one function,
// asked the same way by the dialog and by `masterExamples.test.ts`, which
// builds the examples through these steps.

import type { GraphNode, Wire } from '@/graph';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import type { ExampleResult } from '@engine/execution/examples.ts';
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
 * them whole: `batch_mode`, the inputs that fan out and the outputs that hand
 * on a list, set together, because none of them does anything alone -- per
 * item with no input declared a list runs once on everything, and a list
 * input on a whole-list node is handed whole. Per item, the inputs *lists*
 * names fan out (every one not typed `list`, when it names none yet: what
 * arrives is not known before it has); whole, none do. And a list follows:
 * per item, every output hands on the list of the answers, and the node it
 * feeds is told so; whole, none says it does. There is no "list" box on a
 * port of its own any more.
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
 * What ▶ Try it would try now, as text (`TryItInline`'s `of`): the node as it
 * runs -- its ports and settings -- and *tried*, what it runs on. Not what
 * only describes it: *request*, the field it was written from; the example's
 * expectation and judge; the shape a try may keep.
 */
export function tryKey(node: GraphNode, tried: Record<string, unknown> | undefined, request?: string): string {
  const runs: Record<string, unknown> = { ...node.config };
  for (const key of ['examples', 'output_schema', request ?? '']) delete runs[key];
  return JSON.stringify([node.inputs, node.outputs, runs, tried ?? null]);
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
 * What came out of a try, as the example's expected output: every output the
 * node hands on, as JSON -- what Try it and `test` then hold each later
 * version to. Trimming it to the fields that matter is the person's to do.
 */
export function keptExpect(outputs: Record<string, unknown> | undefined): string {
  return asExampleText(ownOutputs(outputs));
}

/**
 * How the examples after the first did, in one line under Try it: "and 2
 * more: pass" -- or how many did what, and the first reason one did not.
 * It replaced a ▶ Test button of its own in step 2.
 */
export function othersLine(results: ExampleResult[]): string {
  if (!results.length) return '';
  const count = (status: ExampleResult['status']) => results.filter((result) => result.status === status).length;
  if (count('pass') === results.length) return `and ${results.length} more: pass`;
  const said = ([['pass', 'pass'], ['fail', 'fail'], ['error', 'cannot run'], ['skipped', 'skipped']] as const)
    .filter(([status]) => count(status))
    .map(([status, word]) => `${count(status)} ${word}`);
  const first = results.find((result) => result.status === 'fail' || result.status === 'error');
  const why = first ? ` -- “${first.title}”: ${first.details[0] ?? 'no reason was given'}` : '';
  return `and ${results.length} more: ${said.join(', ')}${why}`;
}
