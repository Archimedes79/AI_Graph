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
from typing import Any, Dict, List, Optional

from app.elements.base import GuiWidgetElement, NodeElement, DeployNeeds
from app.models.graph import GraphNode, GuiWidgetKind, NodeType, gui_widget_ports, sync_gui_node_ports

logger = logging.getLogger(__name__)


async def apply_display_transform(widget, raw_value: Any) -> Any:
    """
    Run a display-only widget's optional transform code over the raw incoming
    value. Because nothing downstream depends on the result, a failure here is
    cosmetic: it becomes the widget's displayed value (a "⚠ … transform
    failed" string) instead of an exception. Used by GuiElement.execute for
    same-round wires and by graph_executor._settle_memory_feedback for
    feedback wires, so a plot fed through a cycle is transformed identically.
    """
    element = _widget_elements().get(widget.kind)
    if element is None:
        return raw_value
    # The element runs its own snippet and decides what a failure costs
    # (`snippet_failure = "cosmetic"` for a display widget), rather than this
    # composite repeating the body lookup, the language lookup and the
    # try/except that three other elements also wrote out.
    transformed = await element.run_snippet(widget, {"value": raw_value})
    return transformed.get("value", raw_value)


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

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        widget_elements = _widget_elements()
        # A gui/widget node IS the graph's interface, so a bundle containing one
        # has to ship the web runtime -- reducing a file picker or a plot to a
        # console prompt would silently deploy something other than what was
        # designed. See deploy_service's "GUI runtime" section.
        needs = DeployNeeds(interactive_ui=True)
        for widget in node.config.gui_widgets:
            element = widget_elements.get(widget.kind)
            if element is not None:
                needs = needs | element.deploy_needs(widget)
        return needs
