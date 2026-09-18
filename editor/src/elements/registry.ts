import type { WidgetKind, NodeType } from '@/graph';
import type { WidgetUi, NodeUi } from './ElementUi';

import { inputNodeUi } from './nodes/input/InputNode.ui';
import { aiNodeUi } from './nodes/ai/AiNode.ui';
import { codeNodeUi } from './nodes/code/CodeNode.ui';
import { dataNodeUi } from './nodes/data/DataNode.ui';
import { outputNodeUi } from './nodes/output/OutputNode.ui';
import { guiNodeUi } from './nodes/gui/GuiNode.ui';

import { inputPickerWidgetUi } from './widgets/input_picker/InputPickerWidget.ui';
import { textIoWidgetUi } from './widgets/text_io/TextIoWidget.ui';
import { imageViewWidgetUi } from './widgets/image_view/ImageViewWidget.ui';
import { plotWindowWidgetUi } from './widgets/plot_window/PlotWindowWidget.ui';
import { tableWidgetUi } from './widgets/table/TableWidget.ui';
import { textWidgetUi } from './widgets/text/TextWidget.ui';
import { dividerWidgetUi } from './widgets/divider/DividerWidget.ui';
import { spacerWidgetUi } from './widgets/spacer/SpacerWidget.ui';
import { selectWidgetUi } from './widgets/select/SelectWidget.ui';
import { sliderWidgetUi } from './widgets/slider/SliderWidget.ui';
import { buttonWidgetUi } from './widgets/button/ButtonWidget.ui';
import { chatWidgetUi } from './widgets/chat/ChatWidget.ui';

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
