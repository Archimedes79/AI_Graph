import type { GraphNode } from '../../types/graph';
import type { NodeElementDefinition } from '../types';
import OutputEditor from './OutputEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

/** A legacy `text_output` node always displays in a window, matching the former
 * TextOutputElement, regardless of its config's write_mode -- same convention as
 * the legacy text_input/file_input/directory_input node types fixing their mode. */
export function effectiveWriteMode(node: GraphNode): 'none' | 'file' | 'directory' | 'window' {
  if (node.node_type === 'text_output') return 'window';
  return node.config.write_mode;
}

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
