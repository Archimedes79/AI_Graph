// The mirror of `engine/src/elements/widgets/StaticWidgetElement.ts`: a widget
// that is part of the page rather than part of the graph -- a heading, a rule,
// a gap. No ports, nothing to run, nothing to author.

import { WidgetUi } from '../WidgetUi';

export abstract class StaticWidgetUi extends WidgetUi {
  /**
   * Page furniture starts unnamed: a name labels a widget's ports, and it has
   * none. The palette's word for it ("Heading", "Divider") would only be text
   * nobody asked to see.
   */
  override initialLabel(): string {
    return '';
  }
}
