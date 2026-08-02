"""chat_window GUI widget compiler."""

from __future__ import annotations

from typing import List

from app.models.graph import GraphNode, GuiWidget


def compile(node: GraphNode, widget: GuiWidget) -> List[str]:
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
