"""The `file_input` node element: read a file's content from a chosen path."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services import file_service


class FileInputElement(NodeElement):
    node_type = NodeType.FILE_INPUT

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        path = file_service.resolve_path(cfg.value or inputs.get("path", ""))
        content = file_service.read_text_file(path)
        return {"content": content, "path": path}

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        return [
            f"_path = _resolve_path(_resolved.get({node.id!r}, {(cfg.value or '')!r}))",
            f"results[{node.id!r}] = {{'content': _read_text_file(_path), 'path': _path}}",
        ]
