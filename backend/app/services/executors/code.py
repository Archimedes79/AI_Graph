"""code node executor."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.models.graph import GraphNode
from app.services import code_executor
from app.services.graph_executor import _reconcile_outputs


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    result = await code_executor.execute_code(cfg.code, cfg.language, inputs)
    return _reconcile_outputs(node, result)
