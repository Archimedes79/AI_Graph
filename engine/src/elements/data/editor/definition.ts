import type { GraphNode } from '@/types/graph';
import type { GraphNodeElementDefinition } from '@/elements/types';
import DataEditor from './Editor';
import { baseNodeConfig } from '@/elements/shared/baseNodeConfig';
import { DataElement } from '../element.ts';
import { fromEngine } from '@/elements/shared/generation';

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

export const dataElement: GraphNodeElementDefinition = {
  nodeType: 'data',
  // A data node IS the graph's register: it holds its value between runs, which
  // is what lets a feedback edge into it close a cycle.
  ownsDescription: true,
  generation: {
    ...fromEngine(new DataElement().generation()),
    promptLabel: 'Format generation prompt',
    promptPlaceholder: 'Describe the records, fields, types, constraints, and examples this node stores.',
    bodyLabel: 'Defined data format',
    bodyPlaceholder: 'Field names, types, dimensions, constraints, and a representative example.',
    mono: true,
    bodyHeight: 140,
    context: (node) => `Standard format family: ${node.config.data_format}.`,
  },
  describeOutput: describeDataFormat,
  ConfigEditor: DataEditor,
  create: (id) => ({
    id,
    node_type: 'data',
    label: 'Data Node',
    description: 'Persist data with an explicit format contract',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'input', name: 'Update', kind: 'input', data_type: 'any', multi: false, required: false, description: 'Optional new value' }],
    outputs: [{ id: 'output', name: 'Value', kind: 'output', data_type: 'any', multi: false, required: false, description: 'Persisted value' }],
    config: { ...baseNodeConfig(), data_format: 'text', data_value: '' },
  }),
};