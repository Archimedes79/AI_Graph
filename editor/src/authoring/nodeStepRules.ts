// What the four steps decide for a node, apart from drawing them.
//
// Kept apart from the component so that what a click does is one function,
// asked the same way by the dialog and by `masterExamples.test.ts`, which
// builds the examples through these steps.

import type { ExecutionResult, GraphNode, NodeResult, Port, Wire } from '@/graph';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import type { ExampleResult } from '@engine/execution/examples.ts';
import type { Refine } from '@engine/host/api.ts';
import type { Tried } from './TryItInline';
import { asExampleText, readPair, withInput } from './examplePair';
import { readFilePorts } from './generationContext';

/** What a node hands on, without the executor's own error port: what a body returns, and an example expects. */
export function ownOutputs(outputs: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(outputs ?? {}).filter(([port]) => port !== ERROR_PORT));
}

/**
 * An input ticked "whole list" takes a list whole, whatever else does: a
 * stop-word list beside the words a node runs once per item on. The tick types
 * it `list` (`wholeList`), so it never fans out.
 */
const takesListWhole = (port: Port): boolean => port.data_type === 'list';

/**
 * *port* handed its list whole ("whole list", step 1, while the node runs once
 * per item) -- or, *whole* false, one item at a time again. Whole, it is typed
 * `list` too: that is how it stays whole when "Run once per item" is ticked
 * again (`withPerItem`), what `check` holds a wire into it to, and what ✨ is
 * told it is handed. An input that reads its files keeps that type, and is
 * only not fanned out. It took editing the node's interface.json by hand.
 */
export function wholeList(port: Port, whole: boolean): Port {
  if (whole) return { ...port, multi: false, ...(port.data_type === 'file_path' ? {} : { data_type: 'list' as const }) };
  return { ...port, multi: true, ...(takesListWhole(port) ? { data_type: 'any' as const } : {}) };
}

/**
 * The input ports a list arrives on, one at a time when the node runs per
 * item: one whose example value is a list, one declared a list, or one wired
 * from an output that hands on a list -- but not one ticked "whole list".
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
 * names fan out (every one not ticked "whole list", when it names none yet:
 * what arrives is not known before it has); whole, none do. And a list follows:
 * per item, every output hands on the list of the answers, and the node it
 * feeds is told so; whole, none says it does. A port has no "list" box of its
 * own: while the node runs per item, an input can only be taken whole instead
 * ("whole list", `wholeList`).
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
 * The inputs that read the file at the path they are given ("Read the file
 * at this path": ticked by hand, or by a wire from paths, `graphStore.connect`)
 * whose example value cannot be a path: a text of several lines, a value that
 * is not text. A file dropped before the box was ticked put its text there,
 * and ▶ Try it then opened that text as a path and failed on ENOENT -- with
 * ✨ Fix offered to repair a body that had never run.
 */
export function unreadablePaths(node: GraphNode, example: Record<string, unknown> | undefined): string[] {
  const path = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && !/[\r\n]/.test(value));
  const read = (value: unknown) => (Array.isArray(value) ? value.every(path) : path(value));
  return readFilePorts(node).filter((port) => !!example && port in example && !read(example[port]));
}

/**
 * What ▶ Try it would try now, as text (`TryItInline`'s `of`): the node as it
 * runs -- its ports and settings -- and *tried*, what it runs on. Not what
 * only describes it: *request*, the field it was written from; the example's
 * expectation and judge; the shape a try may keep. The settings are read in
 * one order, whatever order a node was built or loaded in: the same node
 * read back from a run is the same node (`lastRunOf`).
 */
export function tryKey(node: GraphNode, tried: Record<string, unknown> | undefined, request?: string): string {
  const skipped = new Set(['examples', 'output_schema', request ?? '']);
  const runs = Object.entries(node.config).filter(([key]) => !skipped.has(key)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([node.inputs, node.outputs, runs, tried ?? null]);
}

/**
 * *node*'s result in the last run (*result*), while it is a result of the
 * node as it is: the run ran it (*ranAs*, `graphStore.ranAs`) with the same
 * body, ports and settings. Once one of those changed, "The last run failed
 * here" described a body that is gone, and ✨ Fix sent the new body with the
 * old one's error.
 */
export function lastRunOf(
  node: GraphNode, result: ExecutionResult | null, ranAs: Record<string, GraphNode>, request?: string,
): NodeResult | undefined {
  const ran = ranAs[node.id];
  if (!ran || tryKey(ran, undefined, request) !== tryKey(node, undefined, request)) return undefined;
  return result?.node_results.find((one) => one.node_id === node.id);
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

/** What a body gave, as a model reads it: one output's text as it is, several as JSON. */
function asOutcome(outputs: Record<string, unknown> | undefined): string {
  const own = ownOutputs(outputs);
  const values = Object.values(own);
  if (values.length === 1 && typeof values[0] === 'string') return values[0];
  return JSON.stringify(values.length === 1 ? values[0] : own, null, 2) ?? '';
}

/**
 * What one result says of the body: how it failed, or what it gave -- or both,
 * where it ended `partial`: a failure the node caught onto its error port, or
 * a run per item that lost some of its items. Read as a success, neither was
 * offered ✨ Fix, and a change was never told the error.
 */
function saidOf(result: { status: string; outputs?: Record<string, unknown>; error?: string | null }): { outcome?: string; error?: string } {
  if (result.status === 'error') return { error: result.error || 'It failed, and gave no reason.' };
  const outcome = asOutcome(result.outputs);
  return result.status === 'partial' && result.error ? { outcome, error: result.error } : { outcome };
}

/**
 * What came of the body, as a change to it is asked with ("Say what to
 * change", ✨ Fix): from the try on screen -- what came out, or how it failed,
 * and what it falls short of (*gaps*, the judge's word) -- or, with none, from
 * the last run of the node, whose inputs it then came of. Undefined while
 * neither said anything. `failed`: there is something to fix.
 */
export function whatCameOf(
  tried: Tried | null, gaps: string[] | undefined, lastRun: NodeResult | undefined,
): { said: Omit<Refine, 'body' | 'change'>; failed: boolean; sample?: { values: Record<string, unknown>; origin: string } } | undefined {
  const result = tried?.result;
  if (result && result.status !== 'skipped') {
    const problems = [...(gaps ?? []), ...(tried?.judged ? [`judged by a model: ${tried.judged}`] : [])];
    const said = saidOf(result);
    return { said: { ...said, ...(problems.length ? { problems } : {}) }, failed: !!said.error || problems.length > 0 };
  }
  if (!tried && lastRun && lastRun.status !== 'skipped') {
    const said = saidOf(lastRun);
    const ran = Object.keys(lastRun.inputs ?? {}).length ? { values: lastRun.inputs, origin: 'the last run' } : undefined;
    return { said, failed: !!said.error, ...(ran ? { sample: ran } : {}) };
  }
  return undefined;
}

/** How an example did, in a word: one whose judge could not be asked ran, and is not judged. */
const WORDS: Record<ExampleResult['status'], string> = { pass: 'pass', fail: 'fail', error: 'cannot run', skipped: 'skipped' };
const wordFor = (result: ExampleResult): string => (result.judgeError ? 'not judged' : WORDS[result.status]);

/**
 * How the examples after the first did, in one line under Try it: "and 2
 * more: pass" -- or how many did what, and the first reason one did not.
 * It replaced a ▶ Test button of its own in step 2.
 */
export function othersLine(results: ExampleResult[]): string {
  if (!results.length) return '';
  const words = results.map(wordFor);
  const count = (word: string) => words.filter((one) => one === word).length;
  if (count('pass') === results.length) return `and ${results.length} more: pass`;
  const said = ['pass', 'fail', 'cannot run', 'not judged', 'skipped']
    .filter((word) => count(word))
    .map((word) => `${count(word)} ${word}`);
  const first = results.find((result) => result.status === 'fail' || result.status === 'error');
  const why = first ? ` -- “${first.title}”: ${first.details[0] ?? 'no reason was given'}` : '';
  return `and ${results.length} more: ${said.join(', ')}${why}`;
}
