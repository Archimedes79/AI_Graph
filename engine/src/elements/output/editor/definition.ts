import type { GraphNodeElementDefinition } from '@/elements/types';
import OutputEditor from './Editor';
import { baseNodeConfig } from '@/elements/shared/baseNodeConfig';

export const outputElement: GraphNodeElementDefinition = {
  nodeType: 'output',
  showsResultWindow: (node) => node.config.write_mode === 'window',
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
