import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { describeDeclaredOutput } from '@/authoring/outputFormat';
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

  override readonly outputFormatHint = 'Only needed when something reads the answer. Sent to the model after its instructions on every run, and to ✨ Generate here and in the nodes this one feeds.';

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
    // Nothing of its own to add: the answer format, the message and the
    // ports reach ✨ as the node's facts (`nodeFacts`), in the brief the
    // engine writes -- not as sentences written here.
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
    return describeDeclaredOutput(node.config);
  }
}
