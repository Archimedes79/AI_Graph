import type { NodeElementDefinition } from '../types';
import InputEditor from '../../components/nodes/editors/InputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export const textInputElement: NodeElementDefinition = {
  nodeType: 'text_input',
  ConfigEditor: InputEditor,
  create: (id) => ({
    id,
    node_type: 'text_input',
    label: 'Text Input',
    description: 'A static text value',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: false, required: false, description: '' }],
    config: baseNodeConfig(),
  }),
};
