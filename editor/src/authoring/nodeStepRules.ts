// What the four steps decide for a node, apart from drawing them.
//
// Kept apart from the component so that what a click does is one function,
// asked the same way by the dialog and by `masterExamples.test.ts`, which
// builds the examples through these steps.

import type { GraphNode } from '@/graph';
import { promptText } from '@engine/elements/nodes/ai/prompt.ts';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import { asExampleText } from './examplePair';

/** What a node hands on, without the executor's own error port: what a body returns, and an example expects. */
export function ownOutputs(outputs: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(outputs ?? {}).filter(([port]) => port !== ERROR_PORT));
}

type Wire = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };

/**
 * The input ports a list arrives on: one whose example value is a list, one
 * declared a list, or one wired from an output that hands on a list.
 */
export function listPorts(node: GraphNode, example: Record<string, unknown> | undefined, nodes: GraphNode[] = [], edges: Wire[] = []): string[] {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const wiredList = (port: string) => edges.some((edge) => edge.target === node.id && edge.targetHandle === port
    && byId.get(edge.source)?.outputs.find((output) => output.id === edge.sourceHandle)?.multi === true);
  return node.inputs
    .filter((port) => port.multi || Array.isArray(example?.[port.id]) || wiredList(port.id))
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
 * Per item, the inputs *lists* names fan out (all of them, when it names none
 * yet: what arrives is not known before it has); whole, none do.
 */
export function withPerItem(node: GraphNode, perItem: boolean, lists: string[] = []): GraphNode {
  const fans = (port: string) => perItem && (lists.length ? lists.includes(port) : true);
  return {
    ...node,
    config: { ...node.config, batch_mode: perItem ? 'per_item' : 'whole_list' },
    inputs: node.inputs.map((port) => (port.multi === fans(port.id) ? port : { ...port, multi: fans(port.id) })),
  };
}

/**
 * What came out of a try, as step 2's expected output: every output the node
 * hands on, as JSON -- what `test` then holds each later version to. Trimming
 * it to the fields that matter is the person's to do.
 */
export function keptExpect(outputs: Record<string, unknown> | undefined): string {
  return asExampleText(ownOutputs(outputs));
}

/**
 * What came out of a try, as the answer a model is shown to imitate: one
 * answer, as text. A node run once per item hands on a list of answers, and
 * keeping that list told every later run to answer with a JSON list of one
 * string.
 */
export function keptAnswer(node: GraphNode, outputs: Record<string, unknown> | undefined): string {
  const own = ownOutputs(outputs);
  const values = Object.values(own);
  const answer = values.length === 1 ? values[0] : own;
  const one = runsPerItem(node) && Array.isArray(answer) ? answer[0] : answer;
  return promptText(one);
}
