// ✨ for one node: what its buttons ask the engine, and what comes back, written in.
//
// A node's ✨ writes one of its files -- its input definition (input.js), its
// output definition (output.js), or its body: code.js, prompt.md, or what a
// data node holds -- through one route (`generate`), from one request built
// here: the node as the panel holds it, the graph around it in words
// ({Context}, `graphContext.ts`), what feeds each input and what each output
// feeds, and the files ✨ Input and ✨ Output are given. A node's panel,
// the toolbar's sweep and "what ✨ sends" all build it here, so none of them
// can tell the model less than the others. What comes back is written into the
// node by one pure function (`writtenInto`), and the exchange into its
// history.md.

import type { Graph, GraphNode, Port, Wire } from '@/graph';
import { call, type AICall, type GenerateRequest, type GenerateResponse, type ProbeReport } from '@/api/client';
import type { Refine } from '@engine/host/api.ts';
import { definitionExample, definitionKeys } from '@engine/authoring/definition.ts';
import { exchangeEntry, withExchange } from '@engine/authoring/history.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import { inputSources, outputTargets } from './generationContext';
import { graphContext } from './graphContext';
import { filesOf } from '@/document/givenFiles';

/** What one ✨ writes: a node's input definition, its output definition, or its body. */
export type Write = 'input' | 'output' | 'body';

export type { Refine };

/** Where a node keeps its body, and what the body is: the engine element's own answer (`NodeRunner.generation`). */
export function bodyOf(node: GraphNode): { field: string; kind: 'code' | 'prompt' | 'data' } | undefined {
  const generation = engineRegistry.node(node.node_type)?.generation();
  return generation && { field: generation.fields.body, kind: generation.kind };
}

/** Whether a ✨ of *node*'s writes definitions as well as a body: a code or an ai node's. */
export function hasDefinitions(node: GraphNode): boolean {
  return engineRegistry.node(node.node_type)?.definitions(node as never) !== undefined;
}

/** *node*'s definitions as the engine reads them: '' for one it has none of. */
function definitionsOf(node: GraphNode): { input: string; output: string } {
  return engineRegistry.node(node.node_type)?.definitions(node as never) ?? { input: '', output: '' };
}

/** What *write*'s ✨ writes into, as the node holds it: the definition, or the body as text. */
export function heldBy(node: GraphNode, write: Write): string {
  if (write !== 'body') return definitionsOf(node)[write];
  const field = bodyOf(node)?.field;
  const value = field ? (node.config as Record<string, unknown>)[field] : undefined;
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
}

/**
 * Whether the node holds what *write*'s ✨ writes: something, where its file
 * would otherwise be the stub. A sweep writes what is not, and leaves alone
 * what somebody wrote.
 */
export function isWritten(node: GraphNode, write: Write): boolean {
  return !!heldBy(node, write).trim();
}

/**
 * What one press on *write*'s ✨ writes, in order: for the body of a node that
 * has definitions, what is missing first -- its input definition where it
 * takes something in and has none, its output definition where it has none --
 * so one press does the whole node.
 */
export function writesFor(node: GraphNode, write: Write): Write[] {
  if (write !== 'body' || !hasDefinitions(node)) return [write];
  return [
    ...(node.inputs.length && !isWritten(node, 'input') ? ['input' as const] : []),
    ...(!isWritten(node, 'output') ? ['output' as const] : []),
    'body',
  ];
}

/**
 * Why a definition ✨ wrote does not fit the node -- its example names no
 * input it has, or leaves out an output wired on -- or undefined. It is
 * written all the same, to be seen and changed; what a press would write
 * after it waits, since it would be written against it.
 */
export function unfitDefinition(write: Write, probe: ProbeReport | undefined): string | undefined {
  if (write === 'body' || probe?.status !== 'failed') return undefined;
  return lowerFirst([probe.error, ...probe.problems].filter(Boolean).join(' ')) || 'it does not fit the node.';
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** What a ✨ is called: on its button, in a message, in history.md. */
export function writeName(node: GraphNode, write: Write): string {
  if (write === 'input') return '✨ Input';
  if (write === 'output') return '✨ Output';
  const kind = bodyOf(node)?.kind;
  return kind === 'prompt' ? '✨ Prompt' : kind === 'data' ? '✨ Data' : '✨ Code';
}

/** What an exchange is called in history.md: which ✨, the change asked for, or a fix. */
export function exchangeName(node: GraphNode, write: Write, refine?: Refine): string {
  if (!refine) return writeName(node, write);
  return refine.change?.trim() ? `Change: ${refine.change.trim()}` : '✨ Fix';
}

/** Why ✨ cannot write for *node* yet, or undefined: everything is written from its text. */
export function generationGuard(node: GraphNode): string | undefined {
  return node.description.trim() ? undefined : 'Say what this node should do first: its text is what ✨ writes from.';
}

/** The graph a node sits in, as ✨ is told it. */
interface Around {
  nodes: GraphNode[];
  edges: Wire[];
  metadata: Graph['metadata'];
}

/**
 * The request *write*'s ✨ sends for *node*, exactly -- built in one place,
 * so "what ✨ sends" and the real button cannot describe two different
 * requests. Its history is not sent: nothing is written from it.
 */
export function generateRequest(node: GraphNode, write: Write, around: Around, inputFiles: string[] = [], refine?: Refine): GenerateRequest {
  const config = { ...node.config } as Record<string, unknown>;
  delete config.history;
  return {
    node: { ...node, config } as GenerateRequest['node'],
    write,
    context: graphContext(node.id, around),
    ...(write === 'input' && inputFiles.length ? { input_files: inputFiles.map((path) => ({ path })) } : {}),
    ...(write === 'output' && filesOf(node, 'output').length ? { output_files: filesOf(node, 'output').map((path) => ({ path })) } : {}),
    input_sources: inputSources(node.id, around.nodes, around.edges, true),
    output_targets: outputTargets(node.id, around.nodes, around.edges, true),
    ...(refine ? { refine } : {}),
  };
}

/** What ✨ would send, without sending it: the engine builds the same request and stops at the model. */
export async function previewGeneration(request: GenerateRequest): Promise<AICall[]> {
  const response = await call('generate', { ...request, preview: true });
  return response.calls ?? [];
}

/** A value's port type, as an output definition's example shows it. */
function typeOf(value: unknown): Port['data_type'] {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  return value && typeof value === 'object' ? 'json' : 'any';
}

/**
 * *node*'s outputs as an output definition names them: its example's keys are
 * the outputs. A port already there keeps what it is; a new one is typed by
 * its example, and hands on a list where the node runs once per item. The
 * executor's error port stays while the node catches its failures.
 */
export function outputsFrom(node: GraphNode, definition: string): Port[] {
  const read = definitionExample(definition);
  if (!('example' in read)) return node.outputs;
  const perItem = node.config.batch_mode === 'per_item' && node.inputs.some((port) => port.multi);
  const ports: Port[] = Object.entries(read.example).map(([id, value]) => node.outputs.find((port) => port.id === id) ?? {
    id, name: id, kind: 'output', data_type: typeOf(value), multi: perItem, required: false, description: '',
  });
  const error = node.outputs.find((port) => port.id === ERROR_PORT);
  return error ? [...ports, error] : ports;
}

/**
 * *node* with what *write*'s ✨ brought back written in: the file it wrote --
 * an output definition setting the outputs too -- the text restated where a
 * change was asked, and the exchange at the end of its history.
 */
export function writtenInto(node: GraphNode, write: Write, response: Pick<GenerateResponse, 'result' | 'description' | 'calls'>, name: string, at = new Date()): GraphNode {
  const config = { ...node.config } as Record<string, unknown>;
  let outputs = node.outputs;
  if (write === 'input') config.input_definition = response.result;
  else if (write === 'output') {
    config.output_definition = response.result;
    if (definitionKeys(response.result).length) outputs = outputsFrom(node, response.result);
  } else {
    const body = bodyOf(node);
    if (body) config[body.field] = body.kind === 'data' && node.config.data_format === 'structure' ? JSON.parse(response.result) : response.result;
  }
  config.history = withHistory(node, name, response.calls, at);
  return {
    ...node,
    ...(response.description?.trim() ? { description: response.description.trim() } : {}),
    outputs,
    config: config as GraphNode['config'],
  };
}

/** *node*'s history.md with one more exchange at its end: *calls*, under *name*. */
export function withHistory(node: GraphNode, name: string, calls: AICall[], at = new Date()): string {
  return withExchange(String(node.config.history ?? ''), exchangeEntry(name, calls, at));
}

/**
 * What to say once *write*'s ✨ is done: that it was written -- and, where the
 * engine tried it, on what and how that went, so a body that does not fit its
 * output.js is said now rather than by the next run.
 */
export function resultMessage(name: string, probe: ProbeReport | undefined, changed: boolean): string {
  const done = changed ? `${name}: changed` : `${name}: written`;
  switch (probe?.status) {
    case 'ok':
      return `✅ ${done}, and it fits output.js on the example in input.js.`;
    case 'repaired':
      return `✅ ${done}. The first attempt did not fit output.js on the example; this one does.`;
    case 'failed':
      if (probe.error) return `⚠️ ${done}, but it fails on the example in input.js: ${probe.error}`;
      return `⚠️ ${done}, but ${lowerFirst(probe.problems.join('; '))}`;
    default:
      return `✅ ${done}.`;
  }
}
