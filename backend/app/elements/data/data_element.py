"""The `data` node element: persisted, format-described graph memory."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import AuthoredFile, NodeElement
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

    def authored_file(self, node: GraphNode) -> AuthoredFile:
        """The format contract -- the text neighbours are generated against.

        Markdown while the field holds prose. It becomes a `.py` the day it holds
        a schema declaration instead; that is one word here, because the file
        mechanism is shared.
        """
        return AuthoredFile(body_field="data_format_prompt", prompt_field="data_prompt", extension=".md")
