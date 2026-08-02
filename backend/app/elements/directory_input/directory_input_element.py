"""The `directory_input` node element: list (and optionally filter) a directory's files."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services import ai_service, code_executor, file_service


class DirectoryInputElement(NodeElement):
    node_type = NodeType.DIRECTORY_INPUT

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        path = file_service.resolve_path(cfg.value or inputs.get("path", ""))
        recursive = cfg.extra.get("recursive", False)
        extensions = file_service.parse_extensions_filter(cfg.extra.get("extensions", ""))
        files = file_service.list_directory(path, recursive=recursive, extensions=extensions)
        selector_code = cfg.selector_code.strip()
        if not cfg.select_all_files and not selector_code and cfg.selector_prompt.strip():
            selector_code, _ = await ai_service.generate_code(
                description=cfg.selector_prompt,
                language=cfg.language or "python",
                context='inputs["files"] contains rooted file paths. Return {"files": [...]} with selected paths.',
                inputs=["files"],
                outputs=["files"],
                model=cfg.ai_model,
                provider=cfg.ai_provider,
            )
        if not cfg.select_all_files and selector_code:
            selected = await code_executor.execute_code(
                selector_code, cfg.language or "python", {"files": files}
            )
            files = selected.get("files", files)
        return {"files": files, "count": len(files)}

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        recursive = bool(cfg.extra.get("recursive", False))
        extensions = file_service.parse_extensions_filter(cfg.extra.get("extensions", ""))
        lines = [
            f"_path = _resolve_path(_resolved.get({node.id!r}, {(cfg.value or '')!r}))",
            f"_files = _list_directory(_path, recursive={recursive!r}, extensions={extensions!r})",
        ]
        if not cfg.select_all_files and cfg.selector_code.strip():
            lines.append(
                f"_files = (await _run_code({cfg.selector_code!r}, {(cfg.language or 'python')!r}, "
                f"{{'files': _files}})).get('files', _files)"
            )
        lines.append(f"results[{node.id!r}] = {{'files': _files, 'count': len(_files)}}")
        return lines
