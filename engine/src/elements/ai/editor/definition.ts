import type { GraphNodeElementDefinition } from '@/elements/types';
import AIEditor, { AIAdvanced } from './Editor';
import { baseNodeConfig } from '@/elements/shared/baseNodeConfig';
import { outputFormatContext } from '@/elements/shared/generationContext';
import { AiElement } from '../element.ts';
import { fromEngine } from '@/elements/shared/generation';

export const aiElement: GraphNodeElementDefinition = {
  nodeType: 'ai',
  // The description IS this element's generation prompt, drawn by its own
  // editor -- a second Description field above it showed the same box twice.
  ownsDescription: true,
  generation: {
    ...fromEngine(new AiElement().generation()),
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
      ? `: ${node.config.output_format_prompt}`
      : format === 'example' && node.config.output_example
        ? `: shaped like ${String(node.config.output_example).slice(0, 400)}` : '';
    return `${format}${detail}`;
  },
  outputContract: 'format',
  ConfigEditor: AIEditor,
  AdvancedEditor: AIAdvanced,
  create: (id) => ({
    id,
    node_type: 'ai',
    label: 'AI Node',
    description: 'Send a prompt to an AI model',
    position: { x: 0, y: 0 },
    // One input, one output. There used to be a second, "Context", on every new
    // node: a port most nodes never wire, that looked like it had to be. A
    // second input is one click on the node when it is wanted, and the message
    // template is where it then gets its place.
    inputs: [
      { id: 'prompt', name: 'Prompt', kind: 'input', data_type: 'text', multi: true, required: false, description: 'What to ask. A list asks once per item.' },
    ],
    outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: true, required: false, description: 'The answer. One per item when the prompt was a list.' }],
    config: { ...baseNodeConfig(), system_prompt: 'You are a helpful assistant.' },
  }),
};
