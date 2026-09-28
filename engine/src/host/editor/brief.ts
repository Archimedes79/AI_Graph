// What the variables of a node's prompts say, filled from what the node and the
// graph hold (`authoring/prompts.ts` names them):
//
//     {Node Description}   the heading, the id and kind, then the text
//     {Input Definition}   input.js as it is -- or, while there is none, each
//                          input: its port, its type, where it is wired from
//                          and what that node hands on
//     {Output Definition}  output.js as it is -- or, while there is none, each
//                          output: where it goes and what the node there wants
//     {Context}            the graph around the node, as the editor says it
//     {Example Files}      the files ✨ Input is given: each path, and the start of it
//     {Output Files}       the files ✨ Output is given, the same way
//
// A definition is sent as the file says it: it is what the node was written
// against, and a second wording of it would be a second thing to disagree.
// What can be long is cut to a budget: the prompt has to leave a small local
// model room to answer.

import { nodeDescription, type Variable } from '../../authoring/prompts.ts';
import { definitionsIn } from '../../authoring/definition.ts';
import type { GraphNode, Port } from '../../graph.ts';
import { ERROR_PORT } from '../../execution/wiring.ts';
import { runsPerItem } from '../../execution/batching.ts';
import { registry } from '../../elements/registry.ts';
import type { GenerateRequest } from '../api.ts';

/** How much of each part is shown, in characters. */
export const BUDGET = {
  /** The files ✨ Input or ✨ Output is given, together: several small ones whole, a large one cut. */
  files: 4000,
  /** A value a repair is shown -- what a try returned, what it was handed. */
  preview: 900,
} as const;

/** *text*, cut to *limit* characters, saying how much was left out. */
export function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}… (${trimmed.length - limit} more characters not shown)`;
}

/** A value as the model should read it: JSON, so a string's line breaks and a list's length are visible. */
export function shown(value: unknown, limit: number): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return (Array.isArray(value) ? `a list of ${value.length}: ` : '') + clip(text, limit);
}

/** A port's type in words, as the body is handed it. */
function typeWords(port: Port, reads: boolean): string {
  if (reads) return 'a path: the node reads the file there, and is handed its text';
  const base = port.data_type === 'any' ? '' : port.data_type;
  return base === 'list' ? 'a list' : base;
}

/** Whether a list reaching *node* is handed over an item at a time, one call each: the executor's rule. */
function perItem(node: GraphNode): boolean {
  return runsPerItem(node, registry.node(node.node_type)?.batchMode(node) ?? 'whole');
}

/**
 * What {Input Definition} says: the node's input.js, or -- while it has
 * none -- each input from its wiring: what arrives, in words, for a
 * definition to be written from.
 */
export function inputDefinition(request: GenerateRequest, reads: string[]): string {
  const { node } = request;
  const written = definitionsIn(node).input;
  if (written.trim()) return written.trim();
  if (!node.inputs.length) return 'It has no inputs: nothing is handed to it.';
  const lines = ['None yet. Its inputs:'];
  for (const port of node.inputs) {
    const type = typeWords(port, reads.includes(port.id));
    const said = port.description?.replace(/\s+/g, ' ').trim();
    lines.push(`- \`${port.id}\`${type ? ` (${type})` : ''}${said ? `: ${said}` : ''}`);
    const source = request.input_sources?.[port.id];
    lines.push(source ? `  from ${source}` : '  not wired yet');
  }
  if (perItem(node)) lines.push('A list arrives one item at a time: each call is handed one item.');
  return lines.join('\n');
}

/**
 * What {Output Definition} says: the node's output.js, or -- while it has
 * none -- each output: where it goes and what the node there wants of it.
 */
export function outputDefinition(request: GenerateRequest): string {
  const { node } = request;
  const written = definitionsIn(node).output;
  if (written.trim()) return written.trim();
  const outputs = node.outputs.filter((port) => port.id !== ERROR_PORT);
  if (!outputs.length) return 'None yet, and it has no outputs yet.';
  const lines = ['None yet. Its outputs:'];
  for (const port of outputs) {
    const said = port.description?.replace(/\s+/g, ' ').trim();
    lines.push(`- \`${port.id}\`${said ? `: ${said}` : ''}`);
    const target = request.output_targets?.[port.id];
    lines.push(target ? `  to ${target}` : '  not wired yet');
  }
  if (perItem(node)) lines.push('What each call returns is collected into a list on every output.');
  return lines.join('\n');
}

/**
 * What {Example Files} and {Output Files} say: each file's path and the start
 * of it -- or that there are none. They share one budget: the smallest are
 * given in full first, and what is left is shared by the larger, so several
 * small files all fit and one big one is cut.
 */
export function filesPart(files: { path: string; text?: string }[] | undefined): string {
  const given = (files ?? []).filter((file) => file.path.trim());
  if (!given.length) return 'None.';
  const room = new Map<number, number>();
  let left = BUDGET.files;
  const bySize = given.map((file, at) => ({ at, size: file.text?.trim().length ?? 0 })).sort((a, b) => a.size - b.size);
  bySize.forEach(({ at, size }, index) => {
    const share = Math.max(0, Math.floor(left / (bySize.length - index)));
    room.set(at, Math.min(size, share));
    left -= Math.min(size, share);
  });
  return given.map((file, at) => (file.text === undefined
    ? `${file.path} (it could not be read)`
    : `${file.path}:\n${clip(file.text, Math.max(room.get(at) ?? 0, 1))}`)).join('\n\n');
}

/**
 * Every variable, filled from *request*: the node, its definitions or its
 * wiring, the graph, and the files it is given (read by then). *reads* are
 * the inputs that are handed a file's text.
 */
export function variables(request: GenerateRequest, reads: string[]): Record<Variable, string> {
  return {
    'Node Description': nodeDescription(request.node),
    'Input Definition': inputDefinition(request, reads),
    'Output Definition': outputDefinition(request),
    Context: request.context?.trim() || 'Not given.',
    'Example Files': filesPart(request.input_files),
    'Output Files': filesPart(request.output_files),
  };
}
