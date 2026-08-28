import type { NodeElementDefinition } from '../types';
import AIEditor from './AIEditor';
import { baseNodeConfig } from '../shared/baseNodeConfig';
import { outputFormatContext } from '../shared/generationContext';

export const aiElement: NodeElementDefinition = {
  nodeType: 'ai',
  authoredFile: () => ({ extension: '.md', what: 'this system prompt' }),
  generation: {
    // The one element whose request lives on the node rather than in its config.
    promptField: 'description',
    targetField: 'system_prompt',
    guard: 'Please add a description first.',
    success: '✅ Prompt generated!',
    context: (node) => outputFormatContext(node.config),
  },
  describeOutput: (node) => {
    const format = node.config.output_format;
    if (!format || format === 'text') return 'text';
    const detail = format === 'custom' && node.config.output_format_prompt
      ? `: ${node.config.output_format_prompt}` : '';
    return `${format}${detail}`;
  },
  outputContract: 'format',
  ConfigEditor: AIEditor,
  create: (id) => ({
    id,
    node_type: 'ai',
    label: 'AI Node',
    description: 'Send a prompt to an AI model',
    position: { x: 0, y: 0 },
    inputs: [
      { id: 'prompt', name: 'Prompt batch', kind: 'input', data_type: 'text', multi: true, required: true, description: 'One prompt per batch item' },
      { id: 'context', name: 'Context', kind: 'input', data_type: 'any', multi: true, required: false, description: 'Additional context' },
    ],
    outputs: [{ id: 'output', name: 'Output batch', kind: 'output', data_type: 'text', multi: true, required: false, description: 'One response per prompt item' }],
    config: { ...baseNodeConfig(), system_prompt: 'You are a helpful assistant.' },
  }),
};
