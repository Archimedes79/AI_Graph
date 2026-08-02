import type { NodeElementDefinition } from '../types';
import InputEditor from './InputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';
import type { Port } from '../../types/graph';

export function inputPortsForMode(mode: 'text' | 'file' | 'directory'): { inputs: Port[]; outputs: Port[] } {
  const pathInput: Port = {
    id: 'path',
    name: 'Path',
    kind: 'input',
    data_type: 'file_path',
    multi: false,
    required: false,
    description: 'Override the configured path',
  };
  if (mode === 'text') {
    return {
      inputs: [],
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    };
  }
  if (mode === 'directory') {
    return {
      inputs: [pathInput],
      outputs: [
        { id: 'files', name: 'Files', kind: 'output', data_type: 'file_path', multi: true, required: false, description: 'Rooted file paths' },
        { id: 'count', name: 'Count', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
      ],
    };
  }
  // 'file'
  return {
    inputs: [pathInput],
    outputs: [
      { id: 'content', name: 'Content', kind: 'output', data_type: 'text', multi: false, required: false, description: '' },
      { id: 'path', name: 'Path', kind: 'output', data_type: 'file_path', multi: false, required: false, description: 'Always includes the root' },
    ],
  };
}

export const inputElement: NodeElementDefinition = {
  nodeType: 'input',
  ConfigEditor: InputEditor,
  create: (id) => {
    const ports = inputPortsForMode('text');
    return {
      id,
      node_type: 'input',
      label: 'Input',
      description: 'A text value, file, or directory',
      position: { x: 0, y: 0 },
      inputs: ports.inputs,
      outputs: ports.outputs,
      config: { ...baseNodeConfig(), input_mode: 'text' },
    };
  },
};
