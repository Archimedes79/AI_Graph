import type { GuiWidgetKind, NodeType } from '../types/graph';
import type { GuiWidgetElementDefinition, NodeElementDefinition } from './types';

import { textInputElement } from './text_input/element';
import { fileInputElement } from './file_input/element';
import { directoryInputElement } from './directory_input/element';
import { aiElement } from './ai/element';
import { codeElement } from './code/element';
import { outputElement } from './output/element';
import { textOutputElement } from './text_output/element';
import { mergeElement } from './merge/element';
import { splitElement } from './split/element';
import { guiElement } from './gui/element';

import { fileOpenElement } from './gui/widgets/file_open/element';
import { directoryOpenElement } from './gui/widgets/directory_open/element';
import { textWindowElement } from './gui/widgets/text_window/element';
import { chatWindowElement } from './gui/widgets/chat_window/element';
import { plotWindowElement } from './gui/widgets/plot_window/element';

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
