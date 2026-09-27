// The mirror of `engine/src/elements/widgets/TransformingDisplayRunner.ts`: a
// display widget with an optional transform that shapes what arrives before
// it is drawn -- a chart, a table, an image.
//
// The panel is the transform's, so it is one panel for all three, here at the
// level that has the transform: the four steps every body is built in. Each
// kind says only what differs: what it shows, and so what its code returns.

import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { GuiWidget } from '@/graph';
import type { WidgetPanelProps } from '../WidgetGuiBuilder';
import { DisplayWidgetGuiBuilder } from './DisplayWidgetGuiBuilder';

export abstract class TransformingDisplayGuiBuilder extends DisplayWidgetGuiBuilder {
  override readonly Panel: ComponentType<WidgetPanelProps> = lazy(() => import('./TransformingDisplayPanel'));

  /**
   * Step 2, in one sentence: what the block shows, which is what its code
   * returns. Fixed by the kind -- there is nothing to choose -- so it is said
   * rather than asked. It was said four times over: a fold called "(optional)",
   * a help line, the code box's label and its placeholder.
   */
  abstract readonly shows: string;

  /**
   * What arrives is a path the block reads itself -- an image. A file picked
   * as step 1's example is then kept as its path, and read the way a run reads
   * it; for any other block, what the file says is the example.
   */
  readonly takesPaths: boolean = false;

  /** Its transform: the code, and what was asked of it. */
  protected override initialSettings(): Partial<GuiWidget> {
    return { code: '', code_prompt: '' };
  }
}
