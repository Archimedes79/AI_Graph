import type { GuiWidgetKind, NodeType } from '../types/graph';
import type { GuiWidgetElementDefinition, NodeElementDefinition } from './types';

import { textInputElement } from './text_input/textInputElement';
import { fileInputElement } from './file_input/fileInputElement';
import { directoryInputElement } from './directory_input/directoryInputElement';
import { aiElement } from './ai/aiElement';
import { codeElement } from './code/codeElement';
import { outputElement } from './output/outputElement';
import { textOutputElement } from './text_output/textOutputElement';
import { mergeElement } from './merge/mergeElement';
import { splitElement } from './split/splitElement';
import { guiElement } from './gui/guiElement';

import { fileOpenElement } from './gui/widgets/file_open/fileOpenElement';
import { directoryOpenElement } from './gui/widgets/directory_open/directoryOpenElement';
import { textWindowElement } from './gui/widgets/text_window/textWindowElement';
import { chatWindowElement } from './gui/widgets/chat_window/chatWindowElement';
import { plotWindowElement } from './gui/widgets/plot_window/plotWindowElement';

/** Dispatch table every NodeType resolves through -- see AGENTS.md's element contract. */
export const NODE_ELEMENTS: Record<NodeType, NodeElementDefinition> = {
  text_input: textInputElement,
  file_input: fileInputElement,
  directory_input: directoryInputElement,
  ai: aiElement,
  code: codeElement,
  output: outputElement,
  text_output: textOutputElement,
  merge: mergeElement,
  split: splitElement,
  gui: guiElement,
};

/** Dispatch table every GuiWidgetKind resolves through -- see AGENTS.md's element contract. */
export const GUI_WIDGET_ELEMENTS: Record<GuiWidgetKind, GuiWidgetElementDefinition> = {
  file_open: fileOpenElement,
  directory_open: directoryOpenElement,
  text_window: textWindowElement,
  chat_window: chatWindowElement,
  plot_window: plotWindowElement,
};
