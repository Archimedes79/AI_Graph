"""The `data` node element: persisted, format-described graph memory."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import NodeElement
from app.models.graph import GraphNode, NodeType


class DataElement(NodeElement):
    node_type = NodeType.DATA

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        value = inputs["input"] if "input" in inputs else node.config.data_value
        node.config.data_value = value
        return {"output": value}