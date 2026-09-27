import type { GraphNode } from '@/graph';
import { readInterface, schemaOutline } from '@engine/execution/interface.ts';
import { outputWords } from '@engine/elements/nodes/ai/prompt.ts';

/**
 * What a node says its output is: one declaration, read three ways -- by ✨
 * Generate for the node itself, by the nodes it feeds, and at run time by an
 * ai node's model.
 *
 * It used to be a choice of six formats, of which only "custom" and "example"
 * sent the words and the example anyone wrote: pick JSON and the description
 * under it was kept, shown -- and never read by a model. Now the words are the
 * declaration. A format picked in an older version is put in front of them by
 * the engine's own reading (`outputWords`), so the words box shows what a run
 * sends, and saves it once edited.
 *
 * A module of its own, depending on nothing but the graph's types and engine
 * modules that import nothing, because an element's `…GuiBuilder.ts` imports
 * it: anything that reached the element registry from here would make a cycle.
 */

/** The output format in words, as the node declares it -- empty when it declares none. */
export function outputFormatText(config: GraphNode['config']): string {
  return outputWords(config);
}

/** An answer or result to imitate, when one was kept. */
export function outputExampleText(config: GraphNode['config']): string {
  return String(config.output_example ?? '').trim();
}

/**
 * The declaration in one line, for a neighbour's ✨: the words, the example's
 * start, and the shape a run kept. `text` when nothing is declared.
 */
export function describeDeclaredOutput(config: GraphNode['config']): string {
  const parts: string[] = [];
  const words = outputFormatText(config);
  if (words) parts.push(words);
  const example = outputExampleText(config);
  if (example) parts.push(`shaped like ${example.length > 300 ? `${example.slice(0, 300)}…` : example}`);
  const schema = readInterface(config.output_schema);
  if (schema) parts.push(`returns ${schemaOutline(schema)}`);
  return parts.join('; ') || 'text';
}
