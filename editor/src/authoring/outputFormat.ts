import type { GraphNode } from '@/graph';
import { readInterface, schemaOutline } from '@engine/execution/interface.ts';

/**
 * What a node says its output is: one declaration, read three ways -- by ✨
 * Generate for the node itself, by the nodes it feeds, and at run time by an
 * ai node's model. The words are the declaration: what the person wrote,
 * `output.md` in a project.
 *
 * A module of its own, depending on nothing but the graph's types and engine
 * modules that import nothing, because an element's `…GuiBuilder.ts` imports
 * it: anything that reached the element registry from here would make a cycle.
 */

/** The output format in words, as the node declares it -- empty when it declares none. */
export function outputFormatText(config: GraphNode['config']): string {
  return String(config.output_format_prompt ?? '').trim();
}

/**
 * The declaration in one line, for a neighbour's ✨: the words, and the shape
 * a run kept. `text` when nothing is declared.
 */
export function describeDeclaredOutput(config: GraphNode['config']): string {
  const parts: string[] = [];
  const words = outputFormatText(config);
  if (words) parts.push(words);
  const schema = readInterface(config.output_schema);
  if (schema) parts.push(`returns ${schemaOutline(schema)}`);
  return parts.join('; ') || 'text';
}
