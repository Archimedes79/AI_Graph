"""The `plot_window` GUI widget element: display-only, no output port."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind


class PlotWindowElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.PLOT_WINDOW

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        in_id = f"{widget.id}_in"
        label = widget.label or widget.id
        return [Port(id=in_id, name=label, kind=PortKind.INPUT, data_type=DataType.ANY, multi=True, required=False)], []

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        # Display-only: this is never called (see gui/element.py) since a widget
        # with no output port has its in-place transform handled by the caller.
        return None

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        # Optionally transform the raw incoming value in place; there is no output
        # port to carry it, so display-only widgets write back into `_inputs`.
        in_id = f"{widget.id}_in"
        lines = [f"_raw = _inputs.get({in_id!r})"]
        if widget.code:
            lines.append(
                f"_inputs[{in_id!r}] = (await execute_code({widget.code!r}, {(widget.language or 'python')!r}, "
                "{'value': _raw})).get('value', _raw)"
            )
        return lines
