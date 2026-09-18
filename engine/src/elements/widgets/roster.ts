// The blocks a page is built from.
//
// Each is an element like any other, one level down: it declares its ports,
// owns its settings, and runs. That is what makes a gui node "an object
// hierarchy whose lowest level is again made of graph elements" rather than a
// special case the executor has to know about.
//
// This file is the roster — the only place that knows the whole set, which is
// the role `registry.ts` plays one level up.

import { TextWidget } from './text/TextWidget.ts';
import { DividerWidget } from './divider/DividerWidget.ts';
import { SpacerWidget } from './spacer/SpacerWidget.ts';
import { InputPickerWidget } from './input_picker/InputPickerWidget.ts';
import { TextIoWidget } from './text_io/TextIoWidget.ts';
import { PlotWindowWidget } from './plot_window/PlotWindowWidget.ts';
import { ImageViewWidget } from './image_view/ImageViewWidget.ts';
import { TableWidget } from './table/TableWidget.ts';
import { SelectWidget } from './select/SelectWidget.ts';
import { SliderWidget } from './slider/SliderWidget.ts';
import { ButtonWidget } from './button/ButtonWidget.ts';
import { ChatWidget } from './chat/ChatWidget.ts';

export { InputPickerWidget };

export const WIDGETS = [
  new TextWidget(),
  new DividerWidget(),
  new SpacerWidget(),
  new InputPickerWidget(),
  new TextIoWidget(),
  new PlotWindowWidget(),
  new ImageViewWidget(),
  new TableWidget(),
  new SelectWidget(),
  new SliderWidget(),
  new ButtonWidget(),
  new ChatWidget(),
];
