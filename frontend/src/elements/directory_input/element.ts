import type { NodeElementDefinition } from '../types';
import InputEditor from '../../components/nodes/editors/InputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export const directoryInputElement: NodeElementDefinition = {
  nodeType: 'directory_input',
  ConfigEditor: InputEditor,
  create: (id) => ({
    id,
    node_type: 'directory_input',
    label: 'Directory Input',
    description: 'List files in a directory',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'path', name: 'Path', kind: 'input', data_type: 'text', multi: false, required: false, description: '' }],
    outputs: [
      { id: 'files', name: 'Files', kind: 'output', data_type: 'file_path', multi: true, required: false, description: 'Rooted file paths' },
      { id: 'count', name: 'Count', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
    ],
    config: baseNodeConfig(),
  }),
};
