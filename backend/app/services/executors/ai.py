"""ai node executor."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.models.graph import GraphNode
from app.services import ai_service
from app.services.graph_executor import _reconcile_outputs


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    prompt_parts = []
    for port_id, val in inputs.items():
        if val is not None:
            prompt_parts.append(str(val) if not isinstance(val, str) else val)
    prompt = "\n\n".join(prompt_parts)
    response = await ai_service.complete(
        prompt=prompt,
        system=cfg.system_prompt,
        model=cfg.ai_model,
        temperature=cfg.temperature,
        provider=cfg.ai_provider,
    )
    return _reconcile_outputs(node, {"output": response})
