// What a data node's format contract says, for the panels that show it to other nodes.

import type { GraphNode } from '@/graph';

export function describeDataFormat(node: GraphNode): string {
  const details = node.config.data_format_prompt?.trim();
  return `${node.config.data_format}${details ? `: ${details}` : ''}`;
}

/**
 * The Data node(s) directly wired to *nodeId*'s output, if any.
 *
 * An ai/code node's `output_format` and a downstream Data node's
 * `data_format`/`data_format_prompt` are two separate fields that say the
 * same thing twice -- this is what lets `OutputFormatEditor` show "this
 * node's output is already constrained by node X" and offer to copy that
 * contract in, instead of asking the user to redeclare a format their graph
 * already spells out one hop away.
 */
export function connectedOutputDataNodes(
  nodeId: string,
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string }>,
): GraphNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targets: GraphNode[] = [];
  for (const edge of edges) {
    if (edge.source !== nodeId) continue;
    const target = nodeById.get(edge.target);
    if (target?.node_type === 'data') targets.push(target);
  }
  return targets;
}
