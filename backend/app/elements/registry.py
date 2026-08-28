from __future__ import annotations

from typing import Dict, Optional

from app.elements.ai.ai_element import AIElement
from app.elements.base import Generation, GuiWidgetElement, NodeElement
from app.elements.code.code_element import CodeElement
from app.elements.data.data_element import DataElement
from app.elements.gui.gui_element import GuiElement
from app.elements.gui.widgets.image_view.image_view_element import ImageViewElement
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
    NodeType.DATA:             DataElement(),
    NodeType.OUTPUT:           _output,
    NodeType.GUI:              _gui,
}

GUI_WIDGET_ELEMENTS: Dict[GuiWidgetKind, GuiWidgetElement] = {
    GuiWidgetKind.INPUT_PICKER:     _input_picker,
    GuiWidgetKind.TEXT_IO:          _text_io,
    GuiWidgetKind.PLOT_WINDOW:      PlotWindowElement(),
    GuiWidgetKind.IMAGE_VIEW:       ImageViewElement(),
}


def generation_for(element: str) -> Optional[Generation]:
    """The `Generation` descriptor named by a NodeType or GuiWidgetKind value.

    Both levels share one namespace here -- they never collide, and a caller
    asking "how is this element generated" does not care which level it lives
    at. Same reason `node_files.Authored` covers both.

    This is what lets the generation endpoint take an element name and put the
    element's own contract sentence into the prompt itself: the sentence
    describes what `execute` will do with the snippet, so it stays in the
    element file and is never copied into the editor.
    """
    for enum_cls, table in ((NodeType, NODE_ELEMENTS), (GuiWidgetKind, GUI_WIDGET_ELEMENTS)):
        try:
            key = enum_cls(element)
        except ValueError:
            continue
        found = table.get(key)
        if found is not None:
            return found.generation()
    return None

