"""Registry mapping each GuiWidgetKind to its widget-output executor."""

from __future__ import annotations

from typing import Any, Callable, Dict

from app.models.graph import GuiWidget, GuiWidgetKind
from app.services.gui_widgets import chat_window, directory_open, file_open, text_window

GUI_WIDGET_EXECUTORS: Dict[GuiWidgetKind, Callable[[GuiWidget, Dict[str, Any]], Any]] = {
    GuiWidgetKind.FILE_OPEN: file_open.execute,
    GuiWidgetKind.DIRECTORY_OPEN: directory_open.execute,
    GuiWidgetKind.TEXT_WINDOW: text_window.execute,
    GuiWidgetKind.CHAT_WINDOW: chat_window.execute,
}
