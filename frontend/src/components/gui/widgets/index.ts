import type React from 'react';
import type { GuiWidgetKind } from '../../../types/graph';
import type { GuiWidgetRuntimeProps } from '../widgetProps';
import FileOpenWidget from './FileOpenWidget';
import DirectoryOpenWidget from './DirectoryOpenWidget';
import TextWindowWidget from './TextWindowWidget';
import ChatWindowWidget from './ChatWindowWidget';
import PlotWindowWidget from './PlotWindowWidget';

/**
 * Runtime component per widget kind. Adding a kind means adding exactly one
 * file next to these and one line here.
 */
export const GUI_WIDGET_RUNTIME_COMPONENTS: Record<GuiWidgetKind, React.ComponentType<GuiWidgetRuntimeProps>> = {
  file_open: FileOpenWidget,
  directory_open: DirectoryOpenWidget,
  text_window: TextWindowWidget,
  chat_window: ChatWindowWidget,
  plot_window: PlotWindowWidget,
};
