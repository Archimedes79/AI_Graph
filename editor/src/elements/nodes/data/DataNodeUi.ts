import { lazy } from 'react';
import type { NodeUi } from '../../Ui';
import { baseNodeConfig } from '../baseNodeConfig';
import { DataNodeElement } from '@engine/elements/nodes/data/DataNodeElement.ts';
import { fromEngine } from '@/authoring/generation';
import { describeDataFormat } from './dataFormat';

export const dataNodeUi: NodeUi = {
  nodeType: 'data',
  // A data node IS the graph's register: it holds its value between runs, which
  // is what lets a feedback edge into it close a cycle.
  ownsDescription: true,
  generation: {
    ...fromEngine(new DataNodeElement().generation()),
    promptLabel: 'Format generation prompt',
    promptPlaceholder: 'Describe the records, fields, types, constraints, and examples this node stores.',
    bodyLabel: 'Defined data format',
    bodyPlaceholder: 'Field names, types, dimensions, constraints, and a representative example.',
    mono: true,
    bodyHeight: 140,
    context: (node) => `Standard format family: ${node.config.data_format}.`,
  },
  describeOutput: describeDataFormat,
  Panel: lazy(() => import('./DataNodePanel')),
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