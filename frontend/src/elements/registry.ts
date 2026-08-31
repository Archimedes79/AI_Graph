import type { GuiWidgetKind, NodeType } from '../types/graph';
import type { GuiWidgetElementDefinition, NodeElementDefinition } from './types';

import { inputElement } from './input/inputElement';
import { aiElement } from './ai/aiElement';
import { codeElement } from './code/codeElement';
import { dataElement } from './data/dataElement';
import { outputElement } from './output/outputElement';
import { guiElement } from './gui/guiElement';

import { inputPickerElement } from './gui/widgets/input_picker/inputPickerElement';
import { textIoElement } from './gui/widgets/text_io/textIoElement';
import { imageViewElement } from './gui/widgets/image_view/imageViewElement';
import { plotWindowElement } from './gui/widgets/plot_window/plotWindowElement';
import { tableElement } from './gui/widgets/table/tableElement';
import { textElement } from './gui/widgets/text/textElement';
import { dividerElement } from './gui/widgets/divider/dividerElement';
import { spacerElement } from './gui/widgets/spacer/spacerElement';

/** Dispatch table every NodeType resolves through -- see AGENTS.md's element contract. */
export const NODE_ELEMENTS: Record<NodeType, NodeElementDefinition> = {
  input:            inputElement,
  ai:               aiElement,
  code:             codeElement,
  data:             dataElement,
  output:           outputElement,
  gui:              guiElement,
};

/** Dispatch table every GuiWidgetKind resolves through -- see AGENTS.md's element contract. */
export const GUI_WIDGET_ELEMENTS: Record<GuiWidgetKind, GuiWidgetElementDefinition> = {
  input_picker:    inputPickerElement,
  text_io:         textIoElement,
  plot_window:     plotWindowElement,
  image_view:      imageViewElement,
  table:           tableElement,
  // Page furniture: no ports, never executed.
  text:            textElement,
  divider:         dividerElement,
  spacer:          spacerElement,
};
