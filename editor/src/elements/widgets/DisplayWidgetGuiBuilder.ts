// The mirror of `engine/src/elements/widgets/DisplayWidgetRunner.ts`: a block
// that only shows what arrives on its one input -- a chart, a table, an image.
//
// Nothing to write and nothing to choose: its panel says, in one sentence, what
// it shows, in the words the engine half tells the node wired into it. With no
// output, the block editor never offers it "using this starts the graph".

import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { DisplayWidgetRunner } from '@engine/elements/widgets/DisplayWidgetRunner.ts';
import { WidgetGuiBuilder, type WidgetPanelProps } from '../WidgetGuiBuilder';

export abstract class DisplayWidgetGuiBuilder extends WidgetGuiBuilder {
  override readonly Panel: ComponentType<WidgetPanelProps> = lazy(() => import('./DisplayWidgetPanel'));

  /** The kind's engine half, which says what it draws (`draws`). */
  abstract readonly runner: DisplayWidgetRunner;
}
