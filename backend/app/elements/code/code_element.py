"""The `code` node element: run user/AI-written Python or JavaScript against its inputs.

Reference implementation for AGENTS.md's element contract -- every other
NodeElement should look structurally identical to this one.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.elements.base import NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import code_executor
from app.services.batching import reconcile_outputs


class CodeElement(NodeElement):
    node_type = NodeType.CODE

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        result = await code_executor.execute_code(cfg.code, cfg.language, inputs)
        return reconcile_outputs(node, result)
