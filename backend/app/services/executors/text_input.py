"""text_input node executor."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.models.graph import GraphNode


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    return {"output": cfg.value or inputs.get("value", "")}
