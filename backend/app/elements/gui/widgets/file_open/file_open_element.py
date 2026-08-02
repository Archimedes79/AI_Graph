"""The `file_open` GUI widget element: a chosen/overridden file path.

Reference implementation for AGENTS.md's element contract -- every other
GuiWidgetElement should look structurally identical to this one.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.elements.base import GuiWidgetElement, widget_input_or_value
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind
from app.services import file_service


class FileOpenElement(GuiWidgetElement):
    widget_kind = GuiWidgetKind.FILE_OPEN

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        out_id = f"{widget.id}_out"
        label = widget.label or widget.id
        return [], [Port(id=out_id, name=label, kind=PortKind.OUTPUT, data_type=DataType.FILE_PATH, multi=False, required=False)]

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Optional[str]:
        raw = widget_input_or_value(widget, inputs)
        if not raw:
            return None
        return file_service.resolve_path(raw)

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        out_id = f"{widget.id}_out"
        req_key = f"{node.id}::{widget.id}"
        return [
            f"_raw = _resolved.get({req_key!r}, {widget.value!r})",
            f"_gui_result[{out_id!r}] = _resolve_path(_raw) if _raw else None",
        ]
