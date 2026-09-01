"""The unified input picker widget element: file | directory, via widget.mode."""

from __future__ import annotations

from typing import List, Tuple

from app.elements.base import (AuthoredFile, Generation, GuiWidgetElement,
                               SELECTOR_GENERATION)
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind


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

    def authored_file(self, widget: GuiWidget) -> AuthoredFile:
        """The directory-mode file selector: run(inputs: {files}) -> {files}."""
        return AuthoredFile(body_field="selector_code", prompt_field="selector_prompt",
                            extension='.js')

    def generation(self) -> Generation:
        """The shared selector contract -- literally the same object
        `InputElement.generation` returns, because it is one behaviour at two
        levels of the hierarchy. The editor offers it in directory mode only."""
        return SELECTOR_GENERATION
