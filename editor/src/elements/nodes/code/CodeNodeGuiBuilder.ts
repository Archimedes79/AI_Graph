import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import { definitionsIn } from '@engine/authoring/definition.ts';
import { withFile } from '@/document/givenFiles';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

export class CodeNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'code';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Code';

  readonly hint = 'Run JavaScript -- say what it should do, and ✨ writes it';

  readonly icon = '⚙️';

  readonly color = 'var(--ui-node-code, #1a3a2a)';

  override readonly paletteGroup = 'Processing';

  // Its text is what it should do, drawn by its panel above what ✨ writes from it.
  override readonly ownsDescription = true;

  override readonly definesItself = true;

  override readonly Panel = lazy(() => import('./CodeNodePanel'));

  override readonly AdvancedPanel = lazy(() => import('./CodeNodeAdvancedPanel'));

  override readonly advancedSummary = 'ports, once per item, failures';

  override portHint(side: 'inputs' | 'outputs', node: GraphNode): string {
    if (side === 'inputs') {
      const first = node.inputs[0]?.id ?? 'name';
      return `The code reads each one as inputs.${first}; input.js says what each holds.`;
    }
    const keys = node.outputs.filter((port) => port.id !== ERROR_PORT).map((port) => `${port.id}: …`);
    return `run() returns one key per output: { ${keys.join(', ') || 'output: …'} } -- output.js names them.`;
  }

  /** What it hands on is what its output definition says: the nodes it feeds are told that. */
  override describeOutput(node: GraphNode): string {
    const output = definitionsIn(node).output.trim();
    return output ? `what its output.js defines:\n${output}` : '';
  }

  /** A file dropped on it is one its input definition is written from. */
  override dropPort(node: GraphNode): 'path' | undefined {
    return node.inputs.length ? 'path' : undefined;
  }

  override withDropped(node: GraphNode, value: unknown): GraphNode {
    return withFile(node, 'input', String(value));
  }
}
