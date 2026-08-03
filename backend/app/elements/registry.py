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
from app.elements.output.output_element import OutputElement
from app.models.graph import GuiWidgetKind, NodeType

_input = InputElement()
_input_picker = InputPickerElement()
_text_io = TextIOElement()
_output = OutputElement()
_gui = GuiElement()

NODE_ELEMENTS: Dict[NodeType, NodeElement] = {
    NodeType.INPUT:            _input,
    NodeType.AI:               AIElement(),
    NodeType.CODE:             CodeElement(),
    NodeType.OUTPUT:           _output,
    NodeType.GUI:              _gui,
    # A WIDGET node is a GUI node whose `gui_widgets` holds exactly one widget --
    # same element, same execute()/ports() derivation, see gui_element.py.
    NodeType.WIDGET:           _gui,
}

GUI_WIDGET_ELEMENTS: Dict[GuiWidgetKind, GuiWidgetElement] = {
    GuiWidgetKind.INPUT_PICKER:     _input_picker,
    GuiWidgetKind.TEXT_IO:          _text_io,
    GuiWidgetKind.PLOT_WINDOW:      PlotWindowElement(),
}

