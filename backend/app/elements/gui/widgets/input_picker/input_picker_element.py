"""The unified input picker element handling file_open, directory_open, and input_picker widget kinds."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.elements.base import GuiWidgetElement, widget_input_or_value
from app.models.graph import DataType, GraphNode, GuiWidget, GuiWidgetKind, Port, PortKind
from app.services import file_service


def _is_directory(widget: GuiWidget) -> bool:
    """Derive mode from widget.mode, falling back to legacy widget.kind."""
    if widget.mode:
        return widget.mode == "directory"
    return widget.kind == GuiWidgetKind.DIRECTORY_OPEN


class InputPickerElement(GuiWidgetElement):
    # Handles: GuiWidgetKind.INPUT_PICKER, FILE_OPEN, DIRECTORY_OPEN
    widget_kind = GuiWidgetKind.INPUT_PICKER

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        out_id = f"{widget.id}_out"
        label = widget.label or widget.id
        is_dir = _is_directory(widget)
        return (
            [],
            [
                Port(
                    id=out_id,
                    name=label,
                    kind=PortKind.OUTPUT,
                    data_type=DataType.FILE_PATH,
                    multi=is_dir,
                    required=False,
                )
            ],
        )

    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        raw = widget_input_or_value(widget, inputs)
        is_dir = _is_directory(widget)
        if not raw:
            return [] if is_dir else None
        path = file_service.resolve_path(raw)
        if is_dir:
            extensions = file_service.parse_extensions_filter(widget.extensions)
            return file_service.list_directory(path, recursive=False, extensions=extensions)
        return str(path)

    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        out_id = f"{widget.id}_out"
        req_key = f"{node.id}::{widget.id}"
        if _is_directory(widget):
            extensions = file_service.parse_extensions_filter(widget.extensions)
            return [
                f"_raw = _resolved.get({req_key!r}, {widget.value!r})",
                "if _raw:",
                "    _path = _resolve_path(_raw)",
                f"    _gui_result[{out_id!r}] = _list_directory(_path, recursive=False, extensions={extensions!r})",
                "else:",
                f"    _gui_result[{out_id!r}] = []",
            ]
        return [
            f"_raw = _resolved.get({req_key!r}, {widget.value!r})",
            f"_gui_result[{out_id!r}] = _resolve_path(_raw) if _raw else None",
        ]
