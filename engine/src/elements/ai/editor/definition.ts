import type { NodeElementDefinition } from '@/elements/types';
import AIEditor from './Editor';
import { baseNodeConfig } from '@/elements/shared/baseNodeConfig';
import { outputFormatContext } from '@/elements/shared/generationContext';

export const aiElement: NodeElementDefinition = {
  nodeType: 'ai',
  // The description IS this element's generation prompt, drawn by its own
  // editor -- a second Description field above it showed the same box twice.
  ownsDescription: true,
  generation: {
    // The one element whose request lives on the node rather than in its config.
    promptField: 'description',
    targetField: 'system_prompt',
    guard: 'Please add a description first.',
    success: '✅ Prompt generated!',
    promptLabel: 'What this node should do',
    promptPlaceholder: 'Describe what this node should do — ✨ Generate turns it into the system prompt below.',
    bodyLabel: 'System prompt',
    bodyPlaceholder: 'You are a helpful assistant…',
    mono: true,
    bodyHeight: 120,
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
