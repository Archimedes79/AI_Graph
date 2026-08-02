"""The `text_input` node element: a literal text value."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType


class TextInputElement(NodeElement):
    node_type = NodeType.TEXT_INPUT

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        return {"output": cfg.value or inputs.get("value", "")}

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        return [f"results[{node.id!r}] = {{'output': _resolved.get({node.id!r}, {(cfg.value or '')!r})}}"]
