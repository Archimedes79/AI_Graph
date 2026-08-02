"""file_open GUI widget compiler."""

from __future__ import annotations

from typing import List

from app.models.graph import GraphNode, GuiWidget


def compile(node: GraphNode, widget: GuiWidget) -> List[str]:
    out_id = f"{widget.id}_out"
    req_key = f"{node.id}::{widget.id}"
    return [
        f"_raw = _resolved.get({req_key!r}, {widget.value!r})",
        f"_gui_result[{out_id!r}] = str(Path(_raw).expanduser().resolve()) if _raw else None",
    ]
