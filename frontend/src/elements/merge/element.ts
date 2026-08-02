import type { NodeElementDefinition } from '../types';
import MergeSplitEditor from '../../components/nodes/editors/MergeSplitEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export const mergeElement: NodeElementDefinition = {
  nodeType: 'merge',
  ConfigEditor: MergeSplitEditor,
  create: (id) => ({
    id,
    node_type: 'merge',
    label: 'Merge',
    description: 'Merge multiple inputs into one text',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'inputs', name: 'Inputs', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    config: { ...baseNodeConfig(), separator: '\n' },
  }),
};
