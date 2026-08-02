import type { NodeElementDefinition } from '../types';
import TextOutputEditor from '../../components/nodes/editors/TextOutputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

export const textOutputElement: NodeElementDefinition = {
  nodeType: 'text_output',
  ConfigEditor: TextOutputEditor,
  create: (id) => ({
    id,
    node_type: 'text_output',
    label: 'Text Output',
    description: 'Show text to the user in a text window when the graph runs',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    outputs: [],
    config: { ...baseNodeConfig(), output_label: 'Text Output' },
  }),
};
