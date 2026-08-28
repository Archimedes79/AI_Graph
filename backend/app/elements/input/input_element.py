"""The unified input element: text | file | directory, via config.input_mode."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import (AuthoredFile, Generation, NodeElement,
                               SELECTOR_GENERATION, code_extension)
from app.models.graph import GraphNode, NodeType
from app.services import code_executor, file_service


def _effective_mode(node: GraphNode) -> str:
    return node.config.input_mode or "text"


class InputElement(NodeElement):
    node_type = NodeType.INPUT

    async def execute(
        self, node: GraphNode, inputs: Dict[str, Any], effective_formats=None
    ) -> Dict[str, Any]:
        cfg = node.config
        mode = _effective_mode(node)

        if mode == "text":
            return {"output": cfg.value or inputs.get("value", "") or inputs.get("path", "")}

        raw_path = cfg.value or inputs.get("path", "")
        if not raw_path:
            return {"content": "", "path": ""} if mode == "file" else {"files": [], "count": 0}

        path = file_service.resolve_path(raw_path)

        if mode == "directory":
            recursive = cfg.extra.get("recursive", False)
            extensions = file_service.parse_extensions_filter(cfg.extra.get("extensions", ""))
            files = file_service.list_directory(path, recursive=recursive, extensions=extensions)
            selector_code = cfg.selector_code.strip()
            if not cfg.select_all_files and not selector_code and cfg.selector_prompt.strip():
                from app.services import ai_service
                selector_code, _ = await ai_service.generate_code(
                    description=cfg.selector_prompt,
                    language=cfg.language or "python",
                    context=SELECTOR_GENERATION.contract,
                    inputs=["files"], outputs=["files"],
                    model=cfg.ai_model, provider=cfg.ai_provider,
                )
            if not cfg.select_all_files and selector_code:
                selected = await code_executor.execute_code(
                    selector_code, cfg.language or "python", {"files": files}
                )
                files = selected.get("files", files)
            return {"files": files, "count": len(files)}

        # mode == "file"
        content: Any = file_service.read_file(path, mode="text")
        return {"content": content, "path": str(path)}

    def generation(self) -> Generation:
        """The shared selector contract -- literally the same object the
        `input_picker` widget returns, because it is the same behaviour at two
        levels of the object hierarchy. The editor offers it in directory mode
        only; a text or single-file input selects nothing."""
        return SELECTOR_GENERATION

    def authored_file(self, node: GraphNode) -> Optional[AuthoredFile]:
        """In directory mode the selector is real code, so it gets a real file --
        the same one an `input_picker` widget gets. A text or single-file input
        authors nothing and returns None, as before."""
        if _effective_mode(node) != "directory":
            return None
        return AuthoredFile(body_field="selector_code", prompt_field="selector_prompt",
                            extension=code_extension(node.config))

    def runtime_requirements(self, node: GraphNode) -> List[Dict[str, Any]]:
        if not node.config.prompt_at_runtime:
            return []
        return [{
            "node_id": node.id, "label": node.label, "kind": _effective_mode(node),
            "direction": "input", "current_value": node.config.value or "",
        }]
