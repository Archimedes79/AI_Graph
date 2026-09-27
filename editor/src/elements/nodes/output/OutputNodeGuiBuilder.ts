import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

/** Where a result is sent, in words, for the node that makes it. */
function destination(node: GraphNode): string {
  const path = String(node.config.value ?? '').trim();
  const named = path ? ` "${path}"` : '';
  switch (node.config.write_mode) {
    case 'file': return `written to the file${named}: a text as it is, anything else as JSON`;
    case 'directory': return `written into the folder${named}, one file per value`;
    case 'window': return 'shown as text in a window';
    default: return 'shown in the results';
  }
}

/** Ends a branch: shows the result in a window, or writes it to a file or directory. */
export class OutputNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'output';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Output';

  readonly hint = 'Show the result in a window, or write it to a file or directory';

  readonly icon = '📤';

  readonly color = 'var(--ui-node-output, #3a2000)';

  override readonly Panel = lazy(() => import('./OutputNodePanel'));

  // Its description is what the result is, which the node feeding it is told
  // (`wantsOn`): the panel asks for it in those words, beside where it goes.
  override readonly ownsDescription = true;

  // It ends a branch: nothing comes out of it. "path" is read by name.
  override readonly portEditing = { inputs: 'edit', outputs: 'none' } as const;

  override portHint(side: 'inputs' | 'outputs'): string | undefined {
    return side === 'inputs'
      ? 'Every input but “path” is shown or written. A wired “path” overrides the one set above.'
      : undefined;
  }

  /**
   * What the node wired into it is told this result is for: what the output
   * says it is (its description), and where it goes. It used to be told only
   * the value port's own description, empty on every new node -- so a node
   * feeding "table.csv, one row per country" was written for nothing in
   * particular. The path port wants what its name says.
   */
  override wantsOn(node: GraphNode, port: string): string | undefined {
    if (port === 'path') return super.wantsOn(node, port) ?? 'the path to write to, as text';
    return [super.wantsOn(node, port), node.description?.trim(), destination(node)].filter(Boolean).join('; ');
  }

}
