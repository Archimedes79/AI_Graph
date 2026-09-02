import type { GuiWidgetKind, NodeType } from '../types/graph';
import type { GuiWidgetElementDefinition, NodeElementDefinition } from './types';

import { inputElement } from '@engine/elements/input/editor/definition';
import { aiElement } from '@engine/elements/ai/editor/definition';
import { codeElement } from '@engine/elements/code/editor/definition';
import { dataElement } from '@engine/elements/data/editor/definition';
import { outputElement } from '@engine/elements/output/editor/definition';
import { guiElement } from '@engine/elements/gui/editor/definition';

import { inputPickerElement } from '@engine/elements/gui/children/input_picker/editor/definition';
import { textIoElement } from '@engine/elements/gui/children/text_io/editor/definition';
import { imageViewElement } from '@engine/elements/gui/children/image_view/editor/definition';
import { plotWindowElement } from '@engine/elements/gui/children/plot_window/editor/definition';
import { tableElement } from '@engine/elements/gui/children/table/editor/definition';
import { textElement } from '@engine/elements/gui/children/text/editor/definition';
import { dividerElement } from '@engine/elements/gui/children/divider/editor/definition';
import { spacerElement } from '@engine/elements/gui/children/spacer/editor/definition';
import { selectElement } from '@engine/elements/gui/children/select/editor/definition';
import { sliderElement } from '@engine/elements/gui/children/slider/editor/definition';
import { buttonElement } from '@engine/elements/gui/children/button/editor/definition';

/** Dispatch table every NodeType resolves through. */
export const NODE_ELEMENTS: Record<NodeType, NodeElementDefinition> = {
  input:            inputElement,
  ai:               aiElement,
  code:             codeElement,
  data:             dataElement,
  output:           outputElement,
  gui:              guiElement,
};

/** Dispatch table every GuiWidgetKind resolves through. */
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
  select:          selectElement,
  slider:          sliderElement,
  button:          buttonElement,
};
