import type { GraphNode } from '../../types/graph';
import type { NodeElementDefinition } from '../types';
import DataEditor from './DataEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export function describeDataFormat(node: GraphNode): string {
  const details = node.config.data_format_prompt?.trim();
  return `${node.config.data_format}${details ? `: ${details}` : ''}`;
}

export function connectedDataFormatContext(
  nodeId: string,
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string }>,
): string {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const contracts: string[] = [];
  for (const edge of edges) {
    if (edge.target === nodeId) {
      const source = nodeById.get(edge.source);
      if (source?.node_type === 'data') contracts.push(`Source data format from "${source.label}": ${describeDataFormat(source)}`);
    }
    if (edge.source === nodeId) {
      const target = nodeById.get(edge.target);
      if (target?.node_type === 'data') contracts.push(`Target data format required by "${target.label}": ${describeDataFormat(target)}`);
    }
  }
  return contracts.join('\n');
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

export const dataElement: NodeElementDefinition = {
  nodeType: 'data',
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