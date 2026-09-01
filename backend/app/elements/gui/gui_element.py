"""
The `gui` node element -- a Composite: it owns no widget behavior itself, only
dispatches each of its `config.gui_widgets` to that widget's own
GuiWidgetElement (looked up in `elements.registry.GUI_WIDGET_ELEMENTS`) and
merges their results. This is the "gui master element" that contains one or
more sub-elements and synchronizes them: the gui node's ports are exactly the
union of its widgets' ports (see `sync_gui_node_ports`), and its `execute` is
exactly the union of its widgets' `execute`.

A one-widget `gui` node is what the palette's Picker/Text/Plot/Image entries
create; there is no separate node type for it (there used to be a `widget` one,
migrated away at load time). Such a node is simply a `gui` node whose `gui_widgets` holds
exactly one entry -- no separate element, no duplicated logic, just a
single-widget instance of the exact composite below.
"""

from __future__ import annotations

import logging
from typing import Dict

from app.elements.base import GuiWidgetElement, NodeElement
from app.models.graph import GuiWidgetKind, NodeType

logger = logging.getLogger(__name__)




def _widget_elements() -> Dict[GuiWidgetKind, GuiWidgetElement]:
    # Local import: elements.registry imports elements.gui.gui_element (this
    # module) to build NODE_ELEMENTS, so importing registry at module level
    # here would be circular. Only the widget half of the registry is needed.
    from app.elements.registry import GUI_WIDGET_ELEMENTS

    return GUI_WIDGET_ELEMENTS


class GuiElement(NodeElement):
    node_type = NodeType.GUI
    is_memory = True
    config_fields = ("gui_widgets",)

