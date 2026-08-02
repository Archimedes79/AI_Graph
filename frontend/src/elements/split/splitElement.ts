import type { NodeElementDefinition } from '../types';
import MergeSplitEditor from '../shared/MergeSplitEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export const splitElement: NodeElementDefinition = {
  nodeType: 'split',
  ConfigEditor: MergeSplitEditor,
  create: (id) => ({
    id,
    node_type: 'split',
    label: 'Split',
    description: 'Split text into a list',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'text', multi: false, required: true, description: '' }],
    outputs: [
      { id: 'items', name: 'Items', kind: 'output', data_type: 'list', multi: true, required: false, description: '' },
      { id: 'count', name: 'Count', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
    ],
    config: { ...baseNodeConfig(), separator: '\n' },
  }),
};
