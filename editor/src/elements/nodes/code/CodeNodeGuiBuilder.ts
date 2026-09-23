import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { outputFormatContext } from '@/authoring/outputFormat';
import { CodeNodeRunner } from '@engine/elements/nodes/code/CodeNodeRunner.ts';
import { readInterface } from '@engine/execution/interface.ts';
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

  override readonly outputFormatHint = 'Told to ✨ Generate, here and in the nodes this one feeds, so the code is written to hand on this shape. Once the node has run, the shape it really produced is kept below and checked on every later run.';

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
    // What the user chose in THIS node's config, which the graph around it
    // cannot imply: how batches arrive at `run`, and what shape must come back.
    context: (node) => [
      node.config.batch_mode === 'whole_list'
        ? 'Batch mode is `whole_list`: multi input ports arrive in `inputs` as full lists. The generated function must handle or reduce those lists and must not reject an input merely because it is not a string.'
        : 'Batch mode is `per_item`: each multi input port is expanded before `run(inputs)` is called, so one scalar item from each multi port is passed per invocation.',
      outputFormatContext(node.config),
    ].filter(Boolean).join('\n'),
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
    // A kept interface is what a run actually produced: the best description
    // there is of what the next node will be handed.
    const schema = readInterface(node.config.output_schema);
    if (schema) return `its outputs, keyed by port, follow this JSON Schema: ${JSON.stringify(schema)}`;
    const format = node.config.output_format;
    if (!format || format === 'text') return 'text';
    const detail = format === 'custom' && node.config.output_format_prompt
      ? `: ${node.config.output_format_prompt}` : '';
    return `${format}${detail}`;
  }

}
