// The widgets a page is built from: the mirror of `engine/src/elements/widgets/roster.ts`,
// and the only place that knows the whole set.

import type { WidgetKind } from '@/graph';
import type { WidgetUi } from '../WidgetUi';
import { TextWidgetUi } from './text/TextWidgetUi';
import { DividerWidgetUi } from './divider/DividerWidgetUi';
import { SpacerWidgetUi } from './spacer/SpacerWidgetUi';
import { InputPickerWidgetUi } from './input_picker/InputPickerWidgetUi';
import { TextIoWidgetUi } from './text_io/TextIoWidgetUi';
import { PlotWindowWidgetUi } from './plot_window/PlotWindowWidgetUi';
import { ImageViewWidgetUi } from './image_view/ImageViewWidgetUi';
import { TableWidgetUi } from './table/TableWidgetUi';
import { SelectWidgetUi } from './select/SelectWidgetUi';
import { SliderWidgetUi } from './slider/SliderWidgetUi';
import { ButtonWidgetUi } from './button/ButtonWidgetUi';
import { ChatWidgetUi } from './chat/ChatWidgetUi';

/** Every widget kind's Ui, by kind. */
export const WIDGET_UIS: Record<WidgetKind, WidgetUi> = {
  text: new TextWidgetUi(),
  divider: new DividerWidgetUi(),
  spacer: new SpacerWidgetUi(),
  input_picker: new InputPickerWidgetUi(),
  text_io: new TextIoWidgetUi(),
  plot_window: new PlotWindowWidgetUi(),
  image_view: new ImageViewWidgetUi(),
  table: new TableWidgetUi(),
  select: new SelectWidgetUi(),
  slider: new SliderWidgetUi(),
  button: new ButtonWidgetUi(),
  chat: new ChatWidgetUi(),
};
