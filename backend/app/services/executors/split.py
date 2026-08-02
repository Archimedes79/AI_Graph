"""split node executor."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.models.graph import GraphNode


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    sep = cfg.separator
    source = next(iter(inputs.values()), "")
    parts = str(source).split(sep) if source else []
    return {"items": parts, "count": len(parts)}
