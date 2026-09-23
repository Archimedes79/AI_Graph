import type { GraphNode } from '@/graph';
import { readInterface, schemaOutline } from '@engine/execution/interface.ts';

/**
 * What a node says its output is: one declaration, read three ways -- by ✨
 * Generate for the node itself, by the nodes it feeds, and at run time by an
 * ai node's model.
 *
 * It used to be a choice of six formats, of which only "custom" and "example"
 * sent the words and the example anyone wrote: pick JSON and the description
 * under it was kept, shown -- and never read by a model. Now the words are the
 * declaration. A format picked in an older version that the words do not
 * mention yet is put in front of them, so nothing it said is lost.
 *
 * A module of its own, depending on nothing but the graph's types, because an
 * element's `…GuiBuilder.ts` imports it: anything that reached the element
 * registry from here would make a cycle.
 */

/** The older formats that said something the words may not, in words. */
const LEGACY: Record<string, string> = { json: 'JSON', csv: 'CSV', csv_list: 'CSV' };

/** The output format in words, as the node declares it -- empty when it declares none. */
export function outputFormatText(config: GraphNode['config']): string {
  const words = String(config.output_format_prompt ?? '').trim();
  const legacy = LEGACY[String(config.output_format ?? '')];
  if (legacy && !words.toUpperCase().includes(legacy)) return words ? `${legacy}. ${words}` : legacy;
  return words;
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
