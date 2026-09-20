import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { fromEngine, type ElementGeneration } from '@/authoring/generation';
import { outputFormatContext } from '@/authoring/outputFormat';
import { CodeNodeElement } from '@engine/elements/nodes/code/CodeNodeElement.ts';
import { readInterface } from '@engine/execution/interface.ts';
import { NodeUi } from '../../NodeUi';

const STARTER = 'function run(inputs) {\n  return { output: inputs.input ?? "" };\n}\n';

export class CodeNodeUi extends NodeUi {
  readonly nodeType = 'code';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Code Node';

  readonly hint = 'Run JavaScript — write it yourself or have the AI generate it';

  readonly icon = '⚙️';

  readonly color = 'var(--ui-node-code, #1a3a2a)';

  override readonly ownsDescription = true;

  override readonly outputContract = 'format';

  override readonly outputFormatHint = 'This declaration is given to ✨ Generate, here and in the neighbours, so the code produces and expects the right shape. It does not check or convert the value at run time.';

  override readonly Panel = lazy(() => import('./CodeNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./CodeNodeAdvancedPanel'));

  override readonly advancedSummary = 'batching, files, failures';

  override readonly generation: ElementGeneration<GraphNode> = {
    ...fromEngine(new CodeNodeElement().generation()),
    promptLabel: 'Prompt text',
    promptPlaceholder: 'Describe what the generated code should do.',
    bodyLabel: 'Code window (editable)',
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
