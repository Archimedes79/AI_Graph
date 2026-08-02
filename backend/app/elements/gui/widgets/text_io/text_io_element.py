"""Unified text I/O widget handling text_window, chat_window, and text_io widget kinds.

widget.mode controls ports and behaviour:
  "input"  - output port only; user types text that drives the graph
  "output" - input port only; displays incoming value (read-only)
  "both"   - both ports; user's typed text goes out, incoming value is displayed
Legacy text_window / chat_window are treated as mode "both".
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind


def _effective_mode(widget: GuiWidget) -> str:
    if widget.mode in ("input", "output", "both"):
        return widget.mode
    return "both"  # legacy text_window / chat_window default


class TextIOElement(GuiWidgetElement):
    # Handles: GuiWidgetKind.TEXT_IO, TEXT_WINDOW, CHAT_WINDOW
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

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
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

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        mode = _effective_mode(widget)
        in_id, out_id = f"{widget.id}_in", f"{widget.id}_out"
        if mode == "input":
            return [f"_gui_result[{out_id!r}] = {widget.value!r} or ''"]
        if mode == "output":
            return [
                f"_raw = _inputs.get({in_id!r})",
                f"_gui_result[{out_id!r}] = _raw if _raw is not None else ''",
            ]
        # "both": widget's own value wins; fall back to incoming (joining lists) if empty
        return [
            f"if {widget.value!r}:",
            f"    _gui_result[{out_id!r}] = {widget.value!r}",
            "else:",
            f"    _raw = _inputs.get({in_id!r})",
            "    if isinstance(_raw, list):",
            f"        _gui_result[{out_id!r}] = chr(10).join(str(_x) for _x in _raw)",
            "    elif _raw is not None:",
            f"        _gui_result[{out_id!r}] = _raw",
            "    else:",
            f"        _gui_result[{out_id!r}] = ''",
        ]
