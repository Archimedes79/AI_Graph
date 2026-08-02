"""text_output node executor."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.models.graph import GraphNode


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    # Passthrough – the frontend/CLI/runner display these inputs in a text window
    return dict(inputs)
