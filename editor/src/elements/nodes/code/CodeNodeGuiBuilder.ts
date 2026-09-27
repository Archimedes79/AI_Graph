import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { CodeNodeRunner } from '@engine/elements/nodes/code/CodeNodeRunner.ts';
import { CODE_STARTER } from '@/document/nodeKinds';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

export class CodeNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'code';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Code Node';

  readonly hint = 'Run JavaScript — write it yourself or have the AI generate it';

  readonly icon = '⚙️';

  readonly color = 'var(--ui-node-code, #1a3a2a)';

  // Step 3 asks what it should do, and that answer is published as its
  // description (`publishedDescription`): a second box would be a second text.
  override readonly ownsDescription = true;

  override readonly outputContract = 'format';

  // What its example must give, checked: a code node returns the same for the
  // same input, so its example output is a test, not a style to imitate.
  override readonly exampleOutput = 'expect';

  override readonly outputFormatHint = 'Told to ✨ Generate, here and in the nodes this one feeds. Nothing reads it when the graph runs.';

  override readonly Panel = lazy(() => import('./CodeNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./CodeNodeAdvancedPanel'));

  override readonly advancedSummary = 'files, failures, how many at once';

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new CodeNodeRunner().generation()),
    promptLabel: 'What this node should do',
    promptPlaceholder: 'In a sentence or two: what should this node do with what comes in? ✨ Generate writes the code from it.',
    bodyLabel: 'Code',
    bodyPlaceholder: CODE_STARTER.trimEnd(),
    bodyHeight: 220,
    // Batch mode and the declared output reach ✨ as the node's facts
    // (`nodeFacts`), in the brief the engine writes.
  };

  override readonly stepped = true;

  override portHint(side: 'inputs' | 'outputs', node: GraphNode): string {
    if (side === 'inputs') {
      const first = node.inputs[0]?.id ?? 'name';
      return `The code reads each one as inputs.${first}.`;
    }
    const keys = node.outputs.filter((port) => port.id !== 'error').map((port) => `${port.id}: …`);
    return `run() returns one key per output: { ${keys.join(', ') || 'output: …'} }.`;
  }
}
