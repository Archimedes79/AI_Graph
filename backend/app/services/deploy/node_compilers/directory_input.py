"""directory_input node compiler."""

from __future__ import annotations

from typing import Dict, List, Tuple

from app.models.graph import GraphNode
from app.services import file_service


def compile(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    cfg = node.config
    recursive = bool(cfg.extra.get("recursive", False))
    extensions = file_service.parse_extensions_filter(cfg.extra.get("extensions", ""))
    lines = [
        f"_path = str(Path(_resolved.get({node.id!r}, {(cfg.value or '')!r})).expanduser().resolve())",
        f"_files = _list_directory(_path, recursive={recursive!r}, extensions={extensions!r})",
    ]
    if not cfg.select_all_files and cfg.selector_code.strip():
        lines.append(
            f"_files = (await _run_code({cfg.selector_code!r}, {(cfg.language or 'python')!r}, "
            f"{{'files': _files}})).get('files', _files)"
        )
    lines.append(f"results[{node.id!r}] = {{'files': _files, 'count': len(_files)}}")
    return lines
