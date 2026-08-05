"""The unified input picker widget element: file | directory, via widget.mode."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from app.elements.base import DeployNeeds, GuiWidgetElement, widget_input_or_value
from app.models.graph import DataType, GuiWidget, GuiWidgetKind, Port, PortKind
from app.services import code_executor, file_service


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
        language = widget.language or "python"
        if not widget.select_all_files and not selector_code and widget.selector_prompt.strip():
            from app.services import ai_service
            selector_code, _ = await ai_service.generate_code(
                description=widget.selector_prompt,
                language=language,
                context='inputs["files"] contains rooted file paths. Return {"files": [...]} with selected paths.',
                inputs=["files"], outputs=["files"],
                model=widget.ai_model, provider=widget.ai_provider,
            )
        if not widget.select_all_files and selector_code:
            selected = await code_executor.execute_code(selector_code, language, {"files": files})
            files = selected.get("files", files)
        return files

    def runtime_requirement(self, widget: GuiWidget) -> Optional[Dict[str, Any]]:
        if widget.value:
            return None
        label = widget.label or widget.id
        return {"label": label, "kind": "directory" if _is_directory(widget) else "file"}

    def deploy_needs(self, widget: GuiWidget) -> DeployNeeds:
        is_dir = _is_directory(widget)
        code_runner = is_dir and not widget.select_all_files and bool(
            widget.selector_code.strip() or widget.selector_prompt.strip()
        )
        return DeployNeeds(files=True, code_runner=code_runner)
