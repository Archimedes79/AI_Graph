"""text_window GUI widget compiler."""

from __future__ import annotations

from typing import List

from app.models.graph import GraphNode, GuiWidget


def compile(node: GraphNode, widget: GuiWidget) -> List[str]:
    in_id, out_id = f"{widget.id}_in", f"{widget.id}_out"
    return [
        f"_raw = _inputs.get({in_id!r})",
        f"_gui_result[{out_id!r}] = _raw if _raw is not None else {(widget.value or '')!r}",
    ]
