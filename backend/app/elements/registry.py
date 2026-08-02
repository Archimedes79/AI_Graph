from __future__ import annotations

from typing import Dict

from app.elements.ai.ai_element import AIElement
from app.elements.base import GuiWidgetElement, NodeElement
from app.elements.code.code_element import CodeElement
from app.elements.gui.gui_element import GuiElement
from app.elements.gui.widgets.input_picker.input_picker_element import InputPickerElement
from app.elements.gui.widgets.plot_window.plot_window_element import PlotWindowElement
from app.elements.gui.widgets.text_io.text_io_element import TextIOElement
from app.elements.input.input_element import InputElement
from app.elements.merge.merge_element import MergeElement
from app.elements.output.output_element import OutputElement
from app.elements.split.split_element import SplitElement
from app.elements.text_output.text_output_element import TextOutputElement
from app.models.graph import GuiWidgetKind, NodeType

_input = InputElement()
_input_picker = InputPickerElement()
_text_io = TextIOElement()

NODE_ELEMENTS: Dict[NodeType, NodeElement] = {
    NodeType.TEXT_INPUT:       _input,
    NodeType.FILE_INPUT:       _input,
    NodeType.DIRECTORY_INPUT:  _input,
    NodeType.INPUT:            _input,
    NodeType.AI:               AIElement(),
    NodeType.CODE:             CodeElement(),
    NodeType.OUTPUT:           OutputElement(),
    NodeType.TEXT_OUTPUT:      TextOutputElement(),
    NodeType.MERGE:            MergeElement(),
    NodeType.SPLIT:            SplitElement(),
    NodeType.GUI:              GuiElement(),
}

GUI_WIDGET_ELEMENTS: Dict[GuiWidgetKind, GuiWidgetElement] = {
    GuiWidgetKind.FILE_OPEN:        _input_picker,
    GuiWidgetKind.DIRECTORY_OPEN:   _input_picker,
    GuiWidgetKind.INPUT_PICKER:     _input_picker,
    GuiWidgetKind.TEXT_WINDOW:      _text_io,
    GuiWidgetKind.CHAT_WINDOW:      _text_io,
    GuiWidgetKind.TEXT_IO:          _text_io,
    GuiWidgetKind.PLOT_WINDOW:      PlotWindowElement(),
}

