import { lazy } from 'react';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

/** Ends a branch: shows the result in a window, or writes it to a file or directory. */
export class OutputNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'output';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Output';

  readonly hint = 'Show the result in a window, or write it to a file or directory';

  readonly icon = '📤';

  readonly color = 'var(--ui-node-output, #3a2000)';

  override readonly Panel = lazy(() => import('./OutputNodePanel'));

  // It ends a branch: nothing comes out of it. "path" is read by name.
  override readonly portEditing = { inputs: 'edit', outputs: 'none' } as const;

  override portHint(side: 'inputs' | 'outputs'): string | undefined {
    return side === 'inputs'
      ? 'Every input but “path” is shown or written. A wired “path” overrides the one set above.'
      : undefined;
  }

}
