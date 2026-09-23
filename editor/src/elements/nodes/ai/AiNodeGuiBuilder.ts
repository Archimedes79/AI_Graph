import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { outputFormatContext } from '@/authoring/outputFormat';
import { AiNodeRunner } from '@engine/elements/nodes/ai/AiNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

export class AiNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'ai';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'AI Node';

  readonly hint = 'Send a prompt to a local or hosted model and pass on its answer';

  readonly icon = '🤖';

  readonly color = 'var(--ui-node-ai, #2d1b4e)';

  // The description IS this element's generation prompt, drawn by its own
  // panel -- a second Description field above it showed the same box twice.
  override readonly ownsDescription = true;

  override readonly outputContract = 'format';

  override readonly outputFormatLabel = 'Answer format';

  override readonly outputFormatHint = 'Only needed when something downstream has to parse the answer. It becomes a sentence at the end of the instructions, and the neighbours are generated against it. Nothing checks the answer afterwards — a model that ignores it is caught by a Code node, not here.';

  override readonly Panel = lazy(() => import('./AiNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./AiNodeAdvancedPanel'));

  override readonly advancedSummary = 'model, tools, batching, failures';

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new AiNodeRunner().generation()),
    promptLabel: 'What this node should do',
    promptPlaceholder: 'Describe what this node should do — ✨ Generate turns it into the system prompt below.',
    bodyLabel: 'System prompt',
    bodyPlaceholder: 'You are a helpful assistant…',
    exampleLabel: 'Sample of what arrives (optional file) — ✨ Generate is shown it',
    mono: true,
    bodyHeight: 120,
    // Not `outputFormatContext`: that tells a *function* what to return. Here
    // the format is appended to the system prompt by the run itself
    // (`assemblePrompt`), so the instructions being written are told it is
    // taken care of -- a model told "must return JSON" writes that into the
    // prompt a second time, in its own words, beside the engine's.
    context: (node) => {
      const format = outputFormatContext(node.config);
      return format
        ? `The answer format is added after these instructions at run time, by itself -- do not restate it, and do not contradict it. For reference: ${format.replace(/^The function must return output/, 'the answer comes')}`
        : '';
    },
  };

  override readonly stepped = true;

  // The answer arrives on "output": the run hands on what the model said under
  // that one name, so the port can be described but not renamed or added to.
  override readonly portEditing = { inputs: 'edit', outputs: 'describe' } as const;

  override portHint(side: 'inputs' | 'outputs'): string {
    return side === 'inputs'
      ? 'Each input is put into the message below where its {{name}} stands -- or, with no message, sent one after another.'
      : 'The model\'s answer. Its shape is set under “Answer format”.';
  }

  override describeOutput(node: GraphNode): string {
    const format = node.config.output_format;
    if (!format || format === 'text') return 'text';
    const detail = format === 'custom' && node.config.output_format_prompt
      ? `: ${node.config.output_format_prompt}`
      : format === 'example' && node.config.output_example
        ? `: shaped like ${String(node.config.output_example).slice(0, 400)}` : '';
    return `${format}${detail}`;
  }

}
