// The mirror of `engine/src/elements/widgets/TransformingDisplayElement.ts`: a
// display widget with an optional transform that shapes what arrives before
// it is drawn -- a chart, a table, an image.
//
// The panel is the transform's, so it is one panel for all three, here at the
// level that has the transform. Each kind says only what differs: what its
// transform is called and what it must return.

import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { WidgetPanelProps } from '../WidgetUi';
import { DisplayWidgetUi } from './DisplayWidgetUi';

export abstract class TransformingDisplayUi extends DisplayWidgetUi {
  override readonly Panel: ComponentType<WidgetPanelProps> = lazy(() => import('./TransformingDisplayPanel'));

  /** What the transform is called on the fold that opens it: "Row transform (optional)". */
  abstract readonly transformTitle: string;

  /** What the transform must return, said under its body. */
  abstract readonly transformHelp: string;

  /** What the widget does, said above everything else -- for a widget whose use is not obvious. */
  readonly intro: string = '';
}
