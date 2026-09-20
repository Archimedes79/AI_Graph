// The widgets a page is built from: the mirror of `engine/src/elements/widgets/roster.ts`,
// and the only place that knows the whole set.

import type { WidgetKind } from '@/graph';
import type { WidgetGuiBuilder } from '../WidgetGuiBuilder';
import { TextWidgetGuiBuilder } from './text/TextWidgetGuiBuilder';
import { DividerWidgetGuiBuilder } from './divider/DividerWidgetGuiBuilder';
import { SpacerWidgetGuiBuilder } from './spacer/SpacerWidgetGuiBuilder';
import { InputPickerWidgetGuiBuilder } from './input_picker/InputPickerWidgetGuiBuilder';
import { TextIoWidgetGuiBuilder } from './text_io/TextIoWidgetGuiBuilder';
import { PlotWindowWidgetGuiBuilder } from './plot_window/PlotWindowWidgetGuiBuilder';
import { ImageViewWidgetGuiBuilder } from './image_view/ImageViewWidgetGuiBuilder';
import { TableWidgetGuiBuilder } from './table/TableWidgetGuiBuilder';
import { SelectWidgetGuiBuilder } from './select/SelectWidgetGuiBuilder';
import { SliderWidgetGuiBuilder } from './slider/SliderWidgetGuiBuilder';
import { ButtonWidgetGuiBuilder } from './button/ButtonWidgetGuiBuilder';
import { ChatWidgetGuiBuilder } from './chat/ChatWidgetGuiBuilder';

/** Every widget kind's GuiBuilder, by kind. */
export const WIDGET_BUILDERS: Record<WidgetKind, WidgetGuiBuilder> = {
  text: new TextWidgetGuiBuilder(),
  divider: new DividerWidgetGuiBuilder(),
  spacer: new SpacerWidgetGuiBuilder(),
  input_picker: new InputPickerWidgetGuiBuilder(),
  text_io: new TextIoWidgetGuiBuilder(),
  plot_window: new PlotWindowWidgetGuiBuilder(),
  image_view: new ImageViewWidgetGuiBuilder(),
  table: new TableWidgetGuiBuilder(),
  select: new SelectWidgetGuiBuilder(),
  slider: new SliderWidgetGuiBuilder(),
  button: new ButtonWidgetGuiBuilder(),
  chat: new ChatWidgetGuiBuilder(),
};
