// The blocks a page is built from.
//
// Each is an element like any other, one level down: it declares its ports,
// owns its settings, and runs. That is what makes a gui node "an object
// hierarchy whose lowest level is again made of graph elements" rather than a
// special case the executor has to know about.
//
// This file is the roster — the only place that knows the whole set, which is
// the role `registry.ts` plays one level up.

import { TextWidgetElement } from './text/element.ts';
import { DividerElement } from './divider/element.ts';
import { SpacerElement } from './spacer/element.ts';
import { InputPickerElement } from './input_picker/element.ts';
import { TextIoElement } from './text_io/element.ts';
import { PlotWindowElement } from './plot_window/element.ts';
import { ImageViewElement } from './image_view/element.ts';
import { TableElement } from './table/element.ts';
import { SelectElement } from './select/element.ts';
import { SliderElement } from './slider/element.ts';
import { ButtonElement } from './button/element.ts';

export { InputPickerElement };

export const WIDGET_ELEMENTS = [
  new TextWidgetElement(),
  new DividerElement(),
  new SpacerElement(),
  new InputPickerElement(),
  new TextIoElement(),
  new PlotWindowElement(),
  new ImageViewElement(),
  new TableElement(),
  new SelectElement(),
  new SliderElement(),
  new ButtonElement(),
];
