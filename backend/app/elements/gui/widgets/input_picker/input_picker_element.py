"""The unified input picker widget element: file | directory, via widget.mode."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.elements.base import (AuthoredFile, Generation, GuiWidgetElement,
                               SELECTOR_GENERATION, code_extension, widget_input_or_value)
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
        path = file_service.resolve_path(raw)
        if not is_dir:
            return str(path)

        extensions = file_service.parse_extensions_filter(widget.extensions)
        files = file_service.list_directory(path, recursive=widget.recursive, extensions=extensions)

        selector_code = widget.selector_code.strip()
        if not widget.select_all_files and not selector_code and widget.selector_prompt.strip():
            from app.services import ai_service
            selector_code, _ = await ai_service.generate_code(
                description=widget.selector_prompt,
                language=widget.language or "python",
                # The shared contract sentence, not a second wording of it. This
                # call had its own paraphrase while the input node used
                # SELECTOR_GENERATION.contract -- one contract, two texts, which
                # is exactly the drift the shared descriptor exists to prevent.
                context=SELECTOR_GENERATION.contract,
                inputs=["files"], outputs=["files"],
                # No provider argument: a widget carries none any more, so this
                # last-resort generation follows whatever AI the run is
                # configured with (app.services.ai_settings) -- the same one the
                # graph's AI nodes use. In the editor the selector code is
                # normally generated ahead of time via the ✨ button instead.
            )
        if not widget.select_all_files and selector_code:
            selected = await self.run_snippet(widget, {"files": files}, selector_code)
            files = selected.get("files", files)
        return files

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
