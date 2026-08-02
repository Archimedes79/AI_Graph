"""The unified input picker element handling file_open, directory_open, and input_picker widget kinds."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.elements.base import DeployNeeds, GuiWidgetElement, widget_input_or_value
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind
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

    def runtime_requirement(self, widget: GuiWidget) -> Optional[Dict[str, Any]]:
        if widget.value:
            return None
        label = widget.label or widget.id
        return {"label": label, "kind": "directory" if _is_directory(widget) else "file"}

    def deploy_needs(self, widget: GuiWidget) -> DeployNeeds:
        return DeployNeeds(files=True, code_runner=bool(widget.code and widget.code.strip()))
