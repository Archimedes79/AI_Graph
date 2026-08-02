"""The `file_open` GUI widget element: a chosen/overridden file path.

Reference implementation for AGENTS.md's element contract -- every other
GuiWidgetElement should look structurally identical to this one.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.elements.base import GuiWidgetElement
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind


class FileOpenElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.FILE_OPEN

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        out_id = f"{widget.id}_out"
        label = widget.label or widget.id
        return [], [Port(id=out_id, name=label, kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=False, required=False)]

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Optional[str]:
        raw = inputs.get(f"{widget.id}_in")
        if raw is None:
            raw = widget.value
        if not raw:
            return None
        return str(Path(raw).expanduser().resolve())

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        out_id = f"{widget.id}_out"
        req_key = f"{node.id}::{widget.id}"
        return [
            f"_raw = _resolved.get({req_key!r}, {widget.value!r})",
            f"_gui_result[{out_id!r}] = str(Path(_raw).expanduser().resolve()) if _raw else None",
        ]
