"""Unified text I/O widget.

widget.mode controls ports and behaviour:
  "input"  - output port only; user types text that drives the graph
  "output" - input port only; displays incoming value (read-only)
  "both"   - both ports; user's typed text goes out, incoming value is displayed
An unset mode defaults to "both".
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind


def _effective_mode(widget: GuiWidget) -> str:
    if widget.mode in ("input", "output", "both"):
        return widget.mode
    return "both"


class TextIOElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.TEXT_IO

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        mode = _effective_mode(widget)
        label = widget.label or widget.id
        in_port = Port(id=f"{widget.id}_in",  name=label, kind=PortKind.INPUT,  data_type=DataType.ANY,  multi=False, required=False)
        out_port = Port(id=f"{widget.id}_out", name=label, kind=PortKind.OUTPUT, data_type=DataType.TEXT, multi=False, required=False)
        if mode == "input":
            return [], [out_port]
        if mode == "output":
            return [in_port], []
        return [in_port], [out_port]  # "both"

    async def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Dict[str, Any]:
        return {f"{widget.id}_out": self._value(widget, inputs)}

    def _value(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        """What this box holds — which of its three roles it plays decides."""
        mode = _effective_mode(widget)
        in_id = f"{widget.id}_in"
        if mode == "input":
            return widget.value or ""
        incoming = inputs.get(in_id)
        if mode == "output":
            return incoming if incoming is not None else ""
        # "both": widget's own value wins; fall back to incoming if widget is empty
        if widget.value:
            return widget.value
        if incoming is not None:
            # Flatten list inputs (e.g. from a multi-output port)
            if isinstance(incoming, list):
                return "\n".join(str(v) for v in incoming)
            return incoming
        return ""
