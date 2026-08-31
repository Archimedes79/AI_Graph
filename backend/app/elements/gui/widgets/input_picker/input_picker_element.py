"""The unified input picker widget element: file | directory, via widget.mode."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.elements.base import (AuthoredFile, DirectorySource, Generation, GuiWidgetElement,
                               SELECTOR_GENERATION, code_extension, list_selected_files,
                               widget_input_or_value)
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind
from app.services import file_service


def _is_directory(widget: GuiWidget) -> bool:
    return widget.mode == "directory"


class InputPickerElement(GuiWidgetElement):
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

    async def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        raw = widget_input_or_value(widget, inputs)
        is_dir = _is_directory(widget)
        if not raw:
            return [] if is_dir else None
        if not is_dir:
            return str(file_service.resolve_path(raw))

        # The same behaviour the input node runs in directory mode, through the
        # same code -- see `list_selected_files`.
        return await list_selected_files(self, widget, DirectorySource(
            path=raw, recursive=widget.recursive, extensions=widget.extensions,
            select_all=widget.select_all_files, selector_code=widget.selector_code,
            selector_prompt=widget.selector_prompt, language=widget.language or "python",
        ))

    def runtime_requirement(self, widget: GuiWidget) -> Optional[Dict[str, Any]]:
        if widget.value:
            return None
        label = widget.label or widget.id
        return {"label": label, "kind": "directory" if _is_directory(widget) else "file"}

    def authored_file(self, widget: GuiWidget) -> AuthoredFile:
        """The directory-mode file selector: run(inputs: {files}) -> {files}."""
        return AuthoredFile(body_field="selector_code", prompt_field="selector_prompt",
                            extension=code_extension(widget))

    def generation(self) -> Generation:
        """The shared selector contract -- literally the same object
        `InputElement.generation` returns, because it is one behaviour at two
        levels of the hierarchy. The editor offers it in directory mode only."""
        return SELECTOR_GENERATION
