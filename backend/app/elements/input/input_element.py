"""The unified input element: text | file | directory, via config.input_mode."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import (AuthoredFile, DirectorySource, Generation, NodeElement,
                               SELECTOR_GENERATION, code_extension, list_selected_files)
from app.models.graph import GraphNode, NodeType
from app.services import file_service


def _effective_mode(node: GraphNode) -> str:
    return node.config.input_mode or "text"


class InputElement(NodeElement):
    node_type = NodeType.INPUT
    config_fields = (
        "value", "prompt_at_runtime", "input_mode",
        # Directory mode. Same names the input_picker widget uses, because it is
        # the same contract at two levels (see SELECTOR_GENERATION).
        "recursive", "extensions", "select_all_files",
        "selector_prompt", "selector_code", "language",
    )

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

        if mode == "directory":
            # The same behaviour the input_picker widget runs, through the same
            # code: one contract at two levels, implemented once.
            files = await list_selected_files(self, node, DirectorySource(
                path=raw_path, recursive=cfg.recursive, extensions=cfg.extensions,
                select_all=cfg.select_all_files, selector_code=cfg.selector_code,
                selector_prompt=cfg.selector_prompt, language=cfg.language or "python",
            ))
            return {"files": files, "count": len(files)}

        # mode == "file"
        path = file_service.resolve_path(raw_path)
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
