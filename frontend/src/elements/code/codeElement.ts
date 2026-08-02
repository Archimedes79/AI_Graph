import type { NodeElementDefinition } from '../types';
import CodeEditor from './CodeEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';

/**
 * Reference implementation for AGENTS.md's element contract -- every other
 * NodeElementDefinition should look structurally identical to this one.
 */
export const codeElement: NodeElementDefinition = {
  nodeType: 'code',
  ConfigEditor: CodeEditor,
  create: (id) => ({
    id,
    node_type: 'code',
    label: 'Code Node',
    description: 'Execute custom code',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    outputs: [{ id: 'output', name: 'Output batch', kind: 'output', data_type: 'any', multi: true, required: false, description: 'One result per input item' }],
    config: { ...baseNodeConfig(), code: 'def run(inputs):\n    return {"output": inputs.get("input", "")}\n' },
  }),
};
