import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';

/** Ends a branch: shows the result in a window, or writes it to a file or directory. */
export class OutputNodeUi extends NodeUi {
  readonly nodeType = 'output';
  readonly label = 'Output';
  readonly hint = 'Show the result in a window, or write it to a file or directory';
  readonly icon = '📤';
  readonly color = 'var(--ui-node-output, #3a2000)';
  readonly settings: NodeUi['settings'] = ['output_label', 'write_mode', 'value', 'prompt_at_runtime'];

  override readonly Panel = lazy(() => import('./OutputNodePanel'));

  override showsResultWindow(node: GraphNode): boolean {
    return node.config.write_mode === 'window';
  }

  create(id: string): GraphNode {
    return {
      id,
      node_type: 'output',
      label: this.label,
      description: 'Graph output node',
      position: { x: 0, y: 0 },
      inputs: [
        { id: 'value', name: 'Value', kind: 'input', data_type: 'any', multi: true, required: false, description: '' },
        { id: 'path', name: 'Path', kind: 'input', data_type: 'file_path', multi: false, required: false, description: 'Optional wired file/directory path, overriding the config value below.' },
      ],
      outputs: [],
      // A window, not nowhere: an output that shows nothing until someone finds
      // the setting is the one node whose whole point would be missing.
      config: { ...baseNodeConfig(), output_label: 'Result', write_mode: 'window' },
    };
  }
}
