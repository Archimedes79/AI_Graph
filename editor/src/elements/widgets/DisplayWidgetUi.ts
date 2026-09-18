// The mirror of `engine/src/elements/widgets/DisplayWidgetElement.ts`: a widget
// that only shows what arrives on its one input, and emits nothing.

import { WidgetUi } from '../WidgetUi';

export abstract class DisplayWidgetUi extends WidgetUi {
  /** Nothing to operate, so nothing that could start the graph. */
  override readonly runOnChangeHint = '';
}
