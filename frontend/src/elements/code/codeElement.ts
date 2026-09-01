import type { NodeElementDefinition } from '../types';
import CodeEditor from './CodeEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';
import { outputFormatContext } from '../shared/generationContext';

/**
 * Reference implementation for AGENTS.md's element contract -- every other
 * NodeElementDefinition should look structurally identical to this one.
 */
export const codeElement: NodeElementDefinition = {
  nodeType: 'code',
  ownsDescription: true,
  generation: {
    promptField: 'code_prompt',
    targetField: 'code',
    guard: 'Please add a code generation prompt first.',
    success: '✅ Code generated!',
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Describe what the generated code should do.',
    bodyLabel: 'Code window (editable)',
    mono: true,
    bodyPlaceholder: 'function run(inputs) {\n  return { output: inputs.input ?? "" };\n}',
    bodyHeight: 220,
    // What the user chose in THIS node's config, which the graph around it
    // cannot imply: how batches arrive at `run`, and what shape must come back.
    context: (node) => [
      node.config.batch_mode === 'whole_list'
        ? 'Batch mode is `whole_list`: multi input ports arrive in `inputs` as full lists. The generated function must handle or reduce those lists and must not reject an input merely because it is not a string.'
        : 'Batch mode is `per_item`: each multi input port is expanded before `run(inputs)` is called, so one scalar item from each multi port is passed per invocation.',
      outputFormatContext(node.config),
    ].filter(Boolean).join('\n'),
  },
  describeOutput: (node) => {
    const format = node.config.output_format;
    if (!format || format === 'text') return 'text';
    const detail = format === 'custom' && node.config.output_format_prompt
      ? `: ${node.config.output_format_prompt}` : '';
    return `${format}${detail}`;
  },
  outputContract: 'format',
  ConfigEditor: CodeEditor,
  create: (id) => ({
    id,
    node_type: 'code',
    label: 'Code Node',
    description: 'Execute custom code',
    position: { x: 0, y: 0 },
    inputs: [{ id: 'input', name: 'Input', kind: 'input', data_type: 'any', multi: true, required: false, description: '' }],
    outputs: [{ id: 'output', name: 'Output batch', kind: 'output', data_type: 'any', multi: true, required: false, description: 'One result per input item' }],
    config: { ...baseNodeConfig(), code: 'function run(inputs) {\n  return { output: inputs.input ?? "" };\n}\n' },
  }),
};
