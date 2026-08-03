import type { NodeElementDefinition } from '../types';
import OutputEditor from './OutputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export const outputElement: NodeElementDefinition = {
  nodeType: 'output',
  ConfigEditor: OutputEditor,
  create: (id) => ({
    id,
    node_type: 'output',
    label: 'Output',
    description: 'Graph output node',
    position: { x: 0, y: 0 },
    inputs: [
      { id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' },
      { id: 'path', name: 'Path', kind: 'input', data_type: 'file_path', multi: false, required: false, description: 'Optional wired file/directory path, overriding the config value below.' },
    ],
    outputs: [],
    config: { ...baseNodeConfig(), output_label: 'Result' },
  }),
};
