import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { describeDeclaredOutput } from '@/authoring/outputFormat';
import { CodeNodeRunner } from '@engine/elements/nodes/code/CodeNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

const STARTER = 'function run(inputs) {\n  return { output: inputs.input ?? "" };\n}\n';

export class CodeNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'code';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Code Node';

  readonly hint = 'Run JavaScript — write it yourself or have the AI generate it';

  readonly icon = '⚙️';

  readonly color = 'var(--ui-node-code, #1a3a2a)';

  override readonly ownsDescription = true;

  override readonly outputContract = 'format';

  override readonly outputFormatLabel = 'Result format';

  override readonly outputFormatHint = 'Told to ✨ Generate, here and in the nodes this one feeds. Once the node has run, the shape it really produced is kept below and checked on every later run.';

  override readonly Panel = lazy(() => import('./CodeNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./CodeNodeAdvancedPanel'));

  override readonly advancedSummary = 'batching, files, failures';

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new CodeNodeRunner().generation()),
    promptLabel: 'What this node should do',
    promptPlaceholder: 'In a sentence or two: what should this node do with what comes in? ✨ Generate writes the code from it.',
    bodyLabel: 'Code',
    exampleLabel: 'Sample of what arrives (optional file) — ✨ Generate is shown it',
    mono: true,
    bodyPlaceholder: STARTER.trimEnd(),
    bodyHeight: 220,
    // Batch mode and the declared output reach ✨ as the node's facts
    // (`nodeFacts`), in the brief the engine writes.
  };

  override readonly stepped = true;

  override portHint(side: 'inputs' | 'outputs', node: GraphNode): string {
    if (side === 'inputs') {
      const first = node.inputs[0]?.id ?? 'name';
      return `The code reads each one as inputs.${first}. A description tells ✨ Generate what it holds.`;
    }
    const keys = node.outputs.filter((port) => port.id !== 'error').map((port) => `${port.id}: …`);
    return `run() returns one key per output: { ${keys.join(', ') || 'output: …'} }.`;
  }

  override describeOutput(node: GraphNode): string {
    // The kept interface is part of it: what a run actually produced is the
    // best description there is of what the next node will be handed.
    return describeDeclaredOutput(node.config);
  }
}
