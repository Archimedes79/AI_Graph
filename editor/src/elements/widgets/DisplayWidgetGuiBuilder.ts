// The mirror of `engine/src/elements/widgets/DisplayWidgetRunner.ts`: a widget
// that only shows what arrives on its one input, and emits nothing.
//
// Nothing of its own to declare here: with no output, the block editor never
// offers it "using this starts the graph". The class is kept as the mirror,
// and for TransformingDisplayGuiBuilder to extend.

import { WidgetGuiBuilder } from '../WidgetGuiBuilder';

export abstract class DisplayWidgetGuiBuilder extends WidgetGuiBuilder {}
