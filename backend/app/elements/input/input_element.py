"""The unified input element handling text_input, file_input, directory_input, and input node types."""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, List

from app.elements.base import NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import code_executor, file_service


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


def _parse_content(content: str, parse_format: str) -> Any:
    """Apply a named parse_format to raw file text."""
    if parse_format == "json":
        return json.loads(content)
    if parse_format == "csv":
        return list(csv.DictReader(io.StringIO(content)))
    if parse_format == "csv_list":
        return list(csv.reader(io.StringIO(content)))
    return content


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
        content: Any = file_service.read_text_file(path)
        if cfg.parse_format and cfg.parse_format != "text":
            if cfg.parse_format == "custom" and cfg.parse_code.strip():
                result = await code_executor.execute_code(
                    cfg.parse_code, cfg.language or "python",
                    {"content": content, "path": str(path)},
                )
                content = result.get("content", content)
            else:
                content = _parse_content(content, cfg.parse_format)
        return {"content": content, "path": str(path)}

    def compile(self, node: GraphNode, sources, node_map) -> List[str]:
        cfg = node.config
        mode = _effective_mode(node)

        if mode == "text":
            return [
                f"results[{node.id!r}] = {{'output': _resolved.get({node.id!r}, {(cfg.value or '')!r})}}"
            ]

        if mode == "directory":
            recursive = cfg.extra.get("recursive", False)
            extensions = file_service.parse_extensions_filter(cfg.extra.get("extensions", ""))
            return [
                f"_path = _resolve_path(_resolved.get({node.id!r}, {(cfg.value or '')!r}))",
                f"_files = _list_directory(_path, recursive={recursive!r}, extensions={extensions!r})",
                f"results[{node.id!r}] = {{'files': _files, 'count': len(_files)}}",
            ]

        lines: List[str] = [
            f"_path = _resolve_path(_resolved.get({node.id!r}, {(cfg.value or '')!r}))",
            "_content = _read_text_file(_path)",
        ]
        fmt = cfg.parse_format or "text"
        if fmt == "json":
            lines.append("import json as _json; _content = _json.loads(_content)")
        elif fmt == "csv":
            lines.append(
                "import csv as _csv, io as _io;"
                " _content = list(_csv.DictReader(_io.StringIO(_content)))"
            )
        elif fmt == "csv_list":
            lines.append(
                "import csv as _csv, io as _io;"
                " _content = list(_csv.reader(_io.StringIO(_content)))"
            )
        lines.append(f"results[{node.id!r}] = {{'content': _content, 'path': str(_path)}}")
        return lines
