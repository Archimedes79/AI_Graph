// The blocks a page is built from.
//
// Each is an element like any other, one level down: it declares its ports,
// owns its settings, and runs. That is what makes a gui node "an object
// hierarchy whose lowest level is again made of graph elements" rather than a
// special case the executor has to know about.
//
// This file is the roster — the only place that knows the whole set, which is
// the role `registry.ts` plays one level up.

import { TextWidgetElement } from './text/TextWidgetElement.ts';
import { DividerWidgetElement } from './divider/DividerWidgetElement.ts';
import { SpacerWidgetElement } from './spacer/SpacerWidgetElement.ts';
import { InputPickerWidgetElement } from './input_picker/InputPickerWidgetElement.ts';
import { TextIoWidgetElement } from './text_io/TextIoWidgetElement.ts';
import { PlotWindowWidgetElement } from './plot_window/PlotWindowWidgetElement.ts';
import { ImageViewWidgetElement } from './image_view/ImageViewWidgetElement.ts';
import { TableWidgetElement } from './table/TableWidgetElement.ts';
import { SelectWidgetElement } from './select/SelectWidgetElement.ts';
import { SliderWidgetElement } from './slider/SliderWidgetElement.ts';
import { ButtonWidgetElement } from './button/ButtonWidgetElement.ts';
import { ChatWidgetElement } from './chat/ChatWidgetElement.ts';

export { InputPickerWidgetElement };

export const WIDGETS = [
  new TextWidgetElement(),
  new DividerWidgetElement(),
  new SpacerWidgetElement(),
  new InputPickerWidgetElement(),
  new TextIoWidgetElement(),
  new PlotWindowWidgetElement(),
  new ImageViewWidgetElement(),
  new TableWidgetElement(),
  new SelectWidgetElement(),
  new SliderWidgetElement(),
  new ButtonWidgetElement(),
  new ChatWidgetElement(),
];
