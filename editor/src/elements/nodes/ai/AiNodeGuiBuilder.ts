import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { definitionsIn } from '@engine/authoring/definition.ts';
import { withFile } from '@/document/givenFiles';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

export class AiNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'ai';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'AI';

  readonly hint = 'Ask a local or hosted model -- say what it should do, and ✨ writes its prompt';

  readonly icon = '🤖';

  readonly color = 'var(--ui-node-ai, #2d1b4e)';

  override readonly paletteGroup = 'Processing';

  // Its text is what it should do, drawn by its panel above what ✨ writes from it.
  override readonly ownsDescription = true;

  override readonly definesItself = true;

  override readonly Panel = lazy(() => import('./AiNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./AiNodeAdvancedPanel'));

  override readonly advancedSummary = 'ports, model, tools, images, failures';

  // Its outputs are what its output definition names: ✨ Output sets them.
  override readonly portEditing = { inputs: 'edit', outputs: 'fixed' } as const;

  override portHint(side: 'inputs' | 'outputs'): string {
    return side === 'inputs'
      ? 'Sent to the model after its prompt -- each under its id where there are several.'
      : 'One per key of output.js. One that holds text is the answer, as text; with several, or a value that is not text, the answer is that JSON, each key handed on here. Without output.js, the answer as text on "output".';
  }

  /** What it hands on is what its output definition says: the nodes it feeds are told that. */
  override describeOutput(node: GraphNode): string {
    const output = definitionsIn(node).output.trim();
    return output ? `what its output.js defines:\n${output}` : 'the model\'s answer, as text';
  }

  /** A file dropped on it is one its input definition is written from. */
  override dropPort(node: GraphNode): 'path' | undefined {
    return node.inputs.length ? 'path' : undefined;
  }

  override withDropped(node: GraphNode, value: unknown): GraphNode {
    return withFile(node, 'input', String(value));
  }
}
