// The mirror of `engine/src/elements/widgets/DisplayWidgetRunner.ts`: a widget
// that only shows what arrives on its one input, and emits nothing.

import { WidgetGuiBuilder } from '../WidgetGuiBuilder';

export abstract class DisplayWidgetGuiBuilder extends WidgetGuiBuilder {
  /** Nothing to operate, so nothing that could start the graph. */
  override readonly runOnChangeHint = '';
}
