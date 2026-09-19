import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { DataNodeElement } from '@engine/elements/nodes/data/DataNodeElement.ts';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';
import { describeDataFormat } from './dataFormat';

export class DataNodeUi extends NodeUi {
  readonly nodeType = 'data';
  readonly label = 'Data Node';
  readonly hint = 'Remember a value between runs, so a loop can build on its own last result';
  readonly icon = '🗃️';
  readonly color = 'var(--ui-node-data, #183b3b)';
  readonly settings: NodeUi['settings'] = [
    'data_value', 'data_format', 'data_prompt', 'data_format_prompt', 'example_file',
  ];

  // A data node IS the graph's register: it holds its value between runs,
  // which is what lets a feedback edge into it close a cycle.
  override readonly ownsDescription = true;
  override readonly Panel = lazy(() => import('./DataNodePanel'));

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new DataNodeElement().generation()),
    promptLabel: 'Format generation prompt',
    promptPlaceholder: 'Describe the records, fields, types, constraints, and examples this node stores.',
    bodyLabel: 'Defined data format',
    bodyPlaceholder: 'Field names, types, dimensions, constraints, and a representative example.',
    mono: true,
    bodyHeight: 140,
    context: (node) => `Standard format family: ${node.config.data_format}.`,
  };

  override describeOutput(node: GraphNode): string {
    return describeDataFormat(node);
  }

  /** What it remembers, the start of it, under its ports. */
  override canvasSummary(node: GraphNode): string | undefined {
    const value = node.config.data_value;
    if (value === null || value === undefined) return undefined;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  // The wording for a data node is kept verbatim: its format is the one
  // contract a user writes deliberately, and existing prompts were tuned to it.
  override describeAsSource(node: GraphNode, emits: string): string {
    return `Source data format from "${node.label}": ${emits}`;
  }

  override describeAsTarget(node: GraphNode): string {
    return `Target data format required by "${node.label}": ${describeDataFormat(node)}`;
  }

  create(id: string): GraphNode {
    return {
      id,
      node_type: 'data',
      label: this.label,
      description: 'Persist data with an explicit format contract',
      position: { x: 0, y: 0 },
      inputs: [{ id: 'input', name: 'Update', kind: 'input', data_type: 'any', multi: false, required: false, description: 'Optional new value' }],
      outputs: [{ id: 'output', name: 'Value', kind: 'output', data_type: 'any', multi: false, required: false, description: 'Persisted value' }],
      config: { ...baseNodeConfig(), data_format: 'text', data_value: '' },
    };
  }
}
