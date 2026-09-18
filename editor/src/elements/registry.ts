import type { WidgetKind, NodeType } from '@/graph';
import type { WidgetUi, NodeUi } from './Ui';

import { inputNodeUi } from './nodes/input/InputNodeUi';
import { aiNodeUi } from './nodes/ai/AiNodeUi';
import { codeNodeUi } from './nodes/code/CodeNodeUi';
import { dataNodeUi } from './nodes/data/DataNodeUi';
import { outputNodeUi } from './nodes/output/OutputNodeUi';
import { guiNodeUi } from './nodes/gui/GuiNodeUi';

import { inputPickerWidgetUi } from './widgets/input_picker/InputPickerWidgetUi';
import { textIoWidgetUi } from './widgets/text_io/TextIoWidgetUi';
import { imageViewWidgetUi } from './widgets/image_view/ImageViewWidgetUi';
import { plotWindowWidgetUi } from './widgets/plot_window/PlotWindowWidgetUi';
import { tableWidgetUi } from './widgets/table/TableWidgetUi';
import { textWidgetUi } from './widgets/text/TextWidgetUi';
import { dividerWidgetUi } from './widgets/divider/DividerWidgetUi';
import { spacerWidgetUi } from './widgets/spacer/SpacerWidgetUi';
import { selectWidgetUi } from './widgets/select/SelectWidgetUi';
import { sliderWidgetUi } from './widgets/slider/SliderWidgetUi';
import { buttonWidgetUi } from './widgets/button/ButtonWidgetUi';
import { chatWidgetUi } from './widgets/chat/ChatWidgetUi';

/** Dispatch table every NodeType resolves through. */
export const NODE_UIS: Record<NodeType, NodeUi> = {
  input:            inputNodeUi,
  ai:               aiNodeUi,
  code:             codeNodeUi,
  data:             dataNodeUi,
  output:           outputNodeUi,
  gui:              guiNodeUi,
};

/** Dispatch table every WidgetKind resolves through. */
export const WIDGET_UIS: Record<WidgetKind, WidgetUi> = {
  input_picker:    inputPickerWidgetUi,
  text_io:         textIoWidgetUi,
  plot_window:     plotWindowWidgetUi,
  image_view:      imageViewWidgetUi,
  table:           tableWidgetUi,
  // Page furniture: no ports, never executed.
  text:            textWidgetUi,
  divider:         dividerWidgetUi,
  spacer:          spacerWidgetUi,
  select:          selectWidgetUi,
  slider:          sliderWidgetUi,
  button:          buttonWidgetUi,
  chat:            chatWidgetUi,
};
