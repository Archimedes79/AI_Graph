"""The `chat_window` GUI widget element: a non-interactive (v1) chat display/input."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind


class ChatWindowElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.CHAT_WINDOW

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        in_id = f"{widget.id}_in"
        out_id = f"{widget.id}_out"
        label = widget.label or widget.id
        return (
            [Port(id=in_id, name=label, kind=PortKind.INPUT, data_type=DataType.TEXT, multi=True, required=False)],
            [Port(id=out_id, name=label, kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
        )

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> str:
        """
        v1 chat_window is non-interactive: the widget's own `value` (simulated/typed
        message) wins when set, otherwise fall back to the incoming (possibly list,
        since multi=True) wired value, flattened into a single string.
        """
        if widget.value:
            return widget.value
        raw = inputs.get(f"{widget.id}_in")
        if isinstance(raw, list):
            return "\n".join(str(item) for item in raw if item is not None)
        return str(raw) if raw is not None else ""

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        in_id, out_id = f"{widget.id}_in", f"{widget.id}_out"
        return [
            f"if {widget.value!r}:",
            f"    _gui_result[{out_id!r}] = {widget.value!r}",
            "else:",
            f"    _raw = _inputs.get({in_id!r})",
            "    if isinstance(_raw, list):",
            f"        _gui_result[{out_id!r}] = chr(10).join(str(_x) for _x in _raw if _x is not None)",
            "    else:",
            f"        _gui_result[{out_id!r}] = str(_raw) if _raw is not None else ''",
        ]
