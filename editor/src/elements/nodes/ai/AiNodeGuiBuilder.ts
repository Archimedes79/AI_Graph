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

  // An answer is never the same twice, so its example output is not checked:
  // it is the answer the model is shown to imitate, on every run.
  override readonly exampleOutput = 'answer';

  override readonly outputFormatHint = 'Only needed when something reads the answer. Sent to the model after its instructions on every run, and to ✨ Generate here and in the nodes this one feeds.';

  override readonly Panel = lazy(() => import('./AiNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./AiNodeAdvancedPanel'));

  override readonly advancedSummary = 'model, tools, files, failures';

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new AiNodeRunner().generation()),
    promptLabel: 'What this node should do',
    promptPlaceholder: 'Describe what this node should do — ✨ Generate turns it into the instructions in step 4.',
    bodyLabel: 'Instructions (system prompt)',
    bodyPlaceholder: 'You are a helpful assistant…',
    bodyHeight: 120,
    // Nothing of its own to add: the answer format, the message and the
    // ports reach ✨ as the node's facts (`nodeFacts`), in the brief the
    // engine writes -- not as sentences written here.
  };

  override readonly stepped = true;

  // The answer arrives on "output": the run hands on what the model said under
  // that one name, so the port can be neither renamed nor added to.
  override readonly portEditing = { inputs: 'edit', outputs: 'fixed' } as const;

  override portHint(side: 'inputs' | 'outputs'): string {
    return side === 'inputs'
      ? 'Each input is put into the message in step 4 where its {{name}} stands -- or, with no message, sent one after another.'
      : 'The model\'s answer. What it should look like is said below.';
  }

  override describeOutput(node: GraphNode): string {
    return describeDeclaredOutput(node.config);
  }
}
