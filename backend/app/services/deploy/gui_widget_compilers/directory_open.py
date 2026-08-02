"""directory_open GUI widget compiler."""

from __future__ import annotations

from typing import List

from app.models.graph import GraphNode, GuiWidget
from app.services import file_service


def compile(node: GraphNode, widget: GuiWidget) -> List[str]:
    out_id = f"{widget.id}_out"
    req_key = f"{node.id}::{widget.id}"
    extensions = file_service.parse_extensions_filter(widget.extensions)
    return [
        f"_raw = _resolved.get({req_key!r}, {widget.value!r})",
        "if _raw:",
        "    _path = str(Path(_raw).expanduser().resolve())",
        f"    _gui_result[{out_id!r}] = _list_directory(_path, recursive=False, extensions={extensions!r})",
        "else:",
        f"    _gui_result[{out_id!r}] = []",
    ]
