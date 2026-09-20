import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { outputFormatContext } from '@/authoring/outputFormat';
import { AiNodeElement } from '@engine/elements/nodes/ai/AiNodeElement.ts';
import { NodeUi } from '../../NodeUi';

export class AiNodeUi extends NodeUi {
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

}
