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

}
