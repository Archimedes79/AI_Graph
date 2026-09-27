// What a node should hand on, as the graph around it already says.
//
// Step 2's words field starts empty, and what it shows greyed in its place is
// this: what each node or block its outputs are wired to wants (asked of that
// element, `NodeGuiBuilder.wantsOn`), and the shape a run kept. It is what ✨ is
// told whether or not anyone writes a word (`nodeFacts`: output targets and the
// kept shape), so a person writes only what the graph cannot say -- and "Use
// this" copies it in to start from.
//
// It replaced a button that copied one wired data node's format into the
// field: a copy that went stale when the data node changed, dropped a text
// node's details, and said once more what ✨ was told anyway.

import type { GraphNode, Wire } from '@/graph';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import { readInterface, schemaOutline } from '@engine/execution/interface.ts';
import { outputTargets } from './generationContext';

/** The derived output spec of *node*, one line per wired output and one for the kept shape; '' when the graph says nothing. */
export function derivedOutputWords(node: GraphNode, nodes: GraphNode[], edges: Wire[]): string {
  const targets = outputTargets(node.id, nodes, edges, true);
  const own = node.outputs.filter((port) => port.id !== ERROR_PORT);
  const lines = own
    .filter((port) => targets[port.id])
    .map((port) => (own.length > 1 ? `${port.id}: goes to ${targets[port.id]}.` : `Goes to ${targets[port.id]}.`));
  const schema = readInterface(node.config.output_schema);
  if (schema) lines.push(`So far it has returned ${schemaOutline(schema)}.`);
  return lines.join('\n');
}
