"""The unified input element handling text_input, file_input, directory_input, and input node types."""

from __future__ import annotations

from typing import Any, Dict, List

from app.elements.base import NodeElement, DeployNeeds
from app.models.graph import GraphNode, NodeType
from app.services import code_executor, file_service

_RUNTIME_PROMPT_KINDS = {NodeType.TEXT_INPUT: "text", NodeType.FILE_INPUT: "file", NodeType.DIRECTORY_INPUT: "directory"}


def _effective_mode(node: GraphNode) -> str:
    """Derive mode from the legacy node_type first (it's unambiguous); only the
    unified `input` node_type consults config.input_mode, since that field
    defaults to "text" and would otherwise shadow legacy file/directory nodes."""
    if node.node_type == NodeType.FILE_INPUT:
        return "file"
    if node.node_type == NodeType.DIRECTORY_INPUT:
        return "directory"
    if node.node_type == NodeType.TEXT_INPUT:
        return "text"
    return node.config.input_mode or "text"


class InputElement(NodeElement):
    # Handles: NodeType.INPUT, NodeType.TEXT_INPUT, NodeType.FILE_INPUT, NodeType.DIRECTORY_INPUT
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
                    context='inputs["files"] contains rooted file paths. Return {"files": [...]} with selected paths.',
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

    def runtime_requirements(self, node: GraphNode) -> List[Dict[str, Any]]:
        kind = _RUNTIME_PROMPT_KINDS.get(node.node_type)
        if kind is None:
            return []
        return [{
            "node_id": node.id, "label": node.label, "kind": kind,
            "direction": "input", "current_value": node.config.value or "",
        }]

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        mode = _effective_mode(node)
        if mode == "text":
            return DeployNeeds()
        cfg = node.config
        code_runner = mode == "directory" and not cfg.select_all_files and bool(cfg.selector_code.strip())
        return DeployNeeds(files=True, code_runner=code_runner)
