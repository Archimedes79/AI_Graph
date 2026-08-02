"""The `text_window` GUI widget element: a passthrough text display/input."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind


class TextWindowElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.TEXT_WINDOW

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        in_id = f"{widget.id}_in"
        out_id = f"{widget.id}_out"
        label = widget.label or widget.id
        return (
            [Port(id=in_id, name=label, kind=PortKind.INPUT, data_type=DataType.ANY, multi=False, required=False)],
            [Port(id=out_id, name=label, kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)],
        )

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> str:
        """Passthrough: incoming wired value wins, otherwise the widget's own text."""
        raw = inputs.get(f"{widget.id}_in")
        return raw if raw is not None else (widget.value or "")

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        in_id, out_id = f"{widget.id}_in", f"{widget.id}_out"
        return [
            f"_raw = _inputs.get({in_id!r})",
            f"_gui_result[{out_id!r}] = _raw if _raw is not None else {(widget.value or '')!r}",
        ]
