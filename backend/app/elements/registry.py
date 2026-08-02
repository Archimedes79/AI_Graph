"""
Singleton registries mapping each `NodeType` / `GuiWidgetKind` to its one
`NodeElement` / `GuiWidgetElement` instance. See AGENTS.md's "Object-oriented
element contract" for the full picture; `graph_executor.py` and
`deploy_service.py` are the two call sites that look nodes up here, and
`models/graph.py`'s `gui_widget_ports()` looks widgets up here too.
"""

from __future__ import annotations

from typing import Dict

from app.elements.ai.ai_element import AIElement
from app.elements.base import GuiWidgetElement, NodeElement
from app.elements.code.code_element import CodeElement
from app.elements.directory_input.directory_input_element import DirectoryInputElement
from app.elements.file_input.file_input_element import FileInputElement
from app.elements.gui.gui_element import GuiElement
from app.elements.gui.widgets.chat_window.chat_window_element import ChatWindowElement
from app.elements.gui.widgets.directory_open.directory_open_element import (
    DirectoryOpenElement,
)
from app.elements.gui.widgets.file_open.file_open_element import FileOpenElement
from app.elements.gui.widgets.plot_window.plot_window_element import PlotWindowElement
from app.elements.gui.widgets.text_window.text_window_element import TextWindowElement
from app.elements.merge.merge_element import MergeElement
from app.elements.output.output_element import OutputElement
from app.elements.split.split_element import SplitElement
from app.elements.text_input.text_input_element import TextInputElement
from app.elements.text_output.text_output_element import TextOutputElement
from app.models.graph import GuiWidgetKind, NodeType

NODE_ELEMENTS: Dict[NodeType, NodeElement] = {
    NodeType.TEXT_INPUT: TextInputElement(),
    NodeType.FILE_INPUT: FileInputElement(),
    NodeType.DIRECTORY_INPUT: DirectoryInputElement(),
    NodeType.AI: AIElement(),
    NodeType.CODE: CodeElement(),
    NodeType.OUTPUT: OutputElement(),
    NodeType.TEXT_OUTPUT: TextOutputElement(),
    NodeType.MERGE: MergeElement(),
    NodeType.SPLIT: SplitElement(),
    NodeType.GUI: GuiElement(),
}

GUI_WIDGET_ELEMENTS: Dict[GuiWidgetKind, GuiWidgetElement] = {
    GuiWidgetKind.FILE_OPEN: FileOpenElement(),
    GuiWidgetKind.DIRECTORY_OPEN: DirectoryOpenElement(),
    GuiWidgetKind.TEXT_WINDOW: TextWindowElement(),
    GuiWidgetKind.CHAT_WINDOW: ChatWindowElement(),
    GuiWidgetKind.PLOT_WINDOW: PlotWindowElement(),
}
