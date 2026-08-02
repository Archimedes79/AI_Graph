import type { GuiWidgetKind, NodeType } from '../types/graph';
import type { GuiWidgetElementDefinition, NodeElementDefinition } from './types';

import { inputElement } from './input/inputElement';
import { aiElement } from './ai/aiElement';
import { codeElement } from './code/codeElement';
import { outputElement } from './output/outputElement';
import { guiElement } from './gui/guiElement';

import { inputPickerElement } from './gui/widgets/input_picker/inputPickerElement';
import { textIoElement } from './gui/widgets/text_io/textIoElement';
import { plotWindowElement } from './gui/widgets/plot_window/plotWindowElement';

/** Dispatch table every NodeType resolves through -- see AGENTS.md's element contract. */
export const NODE_ELEMENTS: Record<NodeType, NodeElementDefinition> = {
  text_input:       inputElement,
  file_input:       inputElement,
  directory_input:  inputElement,
  input:            inputElement,
  ai:               aiElement,
  code:             codeElement,
  output:           outputElement,
  text_output:      outputElement,
  gui:              guiElement,
};

/** Dispatch table every GuiWidgetKind resolves through -- see AGENTS.md's element contract. */
export const GUI_WIDGET_ELEMENTS: Record<GuiWidgetKind, GuiWidgetElementDefinition> = {
  file_open:       inputPickerElement,
  directory_open:  inputPickerElement,
  input_picker:    inputPickerElement,
  text_window:     textIoElement,
  chat_window:     textIoElement,
  text_io:         textIoElement,
  plot_window:     plotWindowElement,
};
