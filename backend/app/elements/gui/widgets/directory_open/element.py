"""The `directory_open` GUI widget element: a chosen/overridden directory listing."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind
from app.services import file_service


class DirectoryOpenElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.DIRECTORY_OPEN

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        out_id = f"{widget.id}_out"
        label = widget.label or widget.id
        return [], [Port(id=out_id, name=label, kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=True, required=False)]

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> List[str]:
        """List a directory_open widget's chosen/overridden directory, honoring its extension filter."""
        raw = inputs.get(f"{widget.id}_in")
        if raw is None:
            raw = widget.value
        if not raw:
            return []
        path = str(Path(raw).expanduser().resolve())
        extensions = file_service.parse_extensions_filter(widget.extensions)
        return file_service.list_directory(path, recursive=False, extensions=extensions)

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
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
