"""Registry mapping each GuiWidgetKind to its deploy-script line compiler."""

from __future__ import annotations

from typing import Callable, Dict, List

from app.models.graph import GraphNode, GuiWidget, GuiWidgetKind
from app.services.deploy.gui_widget_compilers import (
    chat_window,
    directory_open,
    file_open,
    plot_window,
    text_window,
)

GUI_WIDGET_COMPILERS: Dict[GuiWidgetKind, Callable[[GraphNode, GuiWidget], List[str]]] = {
    GuiWidgetKind.FILE_OPEN: file_open.compile,
    GuiWidgetKind.DIRECTORY_OPEN: directory_open.compile,
    GuiWidgetKind.TEXT_WINDOW: text_window.compile,
    GuiWidgetKind.CHAT_WINDOW: chat_window.compile,
    GuiWidgetKind.PLOT_WINDOW: plot_window.compile,
}
