import type { NodeElementDefinition } from '../types';
import InputEditor from '../../components/nodes/editors/InputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export const fileInputElement: NodeElementDefinition = {
  nodeType: 'file_input',
  ConfigEditor: InputEditor,
  create: (id) => ({
    id,
    node_type: 'file_input',
    label: 'File Input',
    description: 'Read a text file',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'path', name: 'Path', kind: 'input', data_type: 'file_path', multi: false, required: false, description: 'Rooted file path (overrides config)' }],
    outputs: [
      { id: 'content', name: 'Content', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
      { id: 'path', name: 'Path', kind: 'output', data_type: 'file_path', multi: false, required: false, description: 'Always includes the root' },
    ],
    config: baseNodeConfig(),
  }),
};
