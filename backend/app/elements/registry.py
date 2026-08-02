"""
Singleton registries mapping each `NodeType` / `GuiWidgetKind` to its one
`NodeElement` / `GuiWidgetElement` instance. See AGENTS.md's "Object-oriented
element contract" for the full picture; `graph_executor.py` and
`deploy_service.py` are the two call sites that look nodes up here, and
`models/graph.py`'s `gui_widget_ports()` looks widgets up here too.
"""

from __future__ import annotations

from typing import Dict

from app.elements.ai.element import AIElement
from app.elements.base import GuiWidgetElement, NodeElement
from app.elements.code.element import CodeElement
from app.elements.directory_input.element import DirectoryInputElement
from app.elements.file_input.element import FileInputElement
from app.elements.gui.element import GuiElement
from app.elements.gui.widgets.chat_window.element import ChatWindowElement
from app.elements.gui.widgets.directory_open.element import DirectoryOpenElement
from app.elements.gui.widgets.file_open.element import FileOpenElement
from app.elements.gui.widgets.plot_window.element import PlotWindowElement
from app.elements.gui.widgets.text_window.element import TextWindowElement
from app.elements.merge.element import MergeElement
from app.elements.output.element import OutputElement
from app.elements.split.element import SplitElement
from app.elements.text_input.element import TextInputElement
from app.elements.text_output.element import TextOutputElement
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
