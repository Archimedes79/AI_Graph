import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { outputFormatContext } from '@/authoring/outputFormat';
import { AiNodeElement } from '@engine/elements/nodes/ai/AiNodeElement.ts';
import { NodeUi } from '../../NodeUi';
import { baseNodeConfig } from '../baseNodeConfig';

export class AiNodeUi extends NodeUi {
  readonly nodeType = 'ai';
  readonly label = 'AI Node';
  readonly hint = 'Send a prompt to a local or hosted model and pass on its answer';
  readonly icon = '🤖';
  readonly color = 'var(--ui-node-ai, #2d1b4e)';
  readonly settings: NodeUi['settings'] = [
    'ai_provider', 'ai_model', 'system_prompt', 'temperature', 'prompt_template',
    'output_format', 'output_format_prompt', 'output_example', 'mcp_servers', 'send_images',
    'read_file_inputs', 'batch_concurrency', 'example_file', 'catch_errors', 'examples', 'run_code',
  ];

  // The description IS this element's generation prompt, drawn by its own
  // panel -- a second Description field above it showed the same box twice.
  override readonly ownsDescription = true;
  override readonly outputContract = 'format';
  override readonly outputFormatHint = 'Only needed when something downstream has to parse the answer. It becomes a sentence at the end of the instructions, and the neighbours are generated against it. Nothing checks the answer afterwards — a model that ignores it is caught by a Code node, not here.';
  override readonly Panel = lazy(() => import('./AiNodePanel'));
  override readonly AdvancedPanel = lazy(() => import('./AiNodeAdvancedPanel'));
  override readonly advancedSummary = 'model, tools, batching, failures';

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new AiNodeElement().generation()),
    promptLabel: 'What this node should do',
    promptPlaceholder: 'Describe what this node should do — ✨ Generate turns it into the system prompt below.',
    bodyLabel: 'System prompt',
    bodyPlaceholder: 'You are a helpful assistant…',
    mono: true,
    bodyHeight: 120,
    context: (node) => outputFormatContext(node.config),
  };

  override describeOutput(node: GraphNode): string {
    const format = node.config.output_format;
    if (!format || format === 'text') return 'text';
    const detail = format === 'custom' && node.config.output_format_prompt
      ? `: ${node.config.output_format_prompt}`
      : format === 'example' && node.config.output_example
        ? `: shaped like ${String(node.config.output_example).slice(0, 400)}` : '';
    return `${format}${detail}`;
  }

  create(id: string): GraphNode {
    return {
      id,
      node_type: 'ai',
      label: this.label,
      description: 'Send a prompt to an AI model',
      position: { x: 0, y: 0 },
      // One input, one output. There used to be a second, "Context", on every
      // new node: a port most nodes never wire, that looked like it had to be.
      // A second input is one click on the node when it is wanted, and the
      // message template is where it then gets its place.
      inputs: [
        { id: 'prompt', name: 'Prompt', kind: 'input', data_type: 'text', multi: true, required: false, description: 'What to ask. A list asks once per item.' },
      ],
      outputs: [{ id: 'output', name: 'Output', kind: 'output', data_type: 'text', multi: true, required: false, description: 'The answer. One per item when the prompt was a list.' }],
      config: { ...baseNodeConfig(), system_prompt: 'You are a helpful assistant.' },
    };
  }
}
