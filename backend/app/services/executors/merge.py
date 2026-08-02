"""merge node executor."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from app.models.graph import GraphNode

logger = logging.getLogger(__name__)


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    mode = cfg.merge_mode
    if mode == "concat":
        sep = cfg.separator
        parts = []
        for val in inputs.values():
            if isinstance(val, list):
                parts.extend(str(v) for v in val)
            elif val is not None:
                parts.append(str(val))
        return {"output": sep.join(parts)}

    flat: List[Any] = []
    for val in inputs.values():
        if isinstance(val, list):
            flat.extend(v for v in val if v is not None)
        elif val is not None:
            flat.append(val)

    if mode == "sum":
        total = sum(float(v) for v in flat)
        return {"output": int(total) if total.is_integer() else total}
    if mode == "count":
        return {"output": len(flat)}
    if mode == "json_list":
        return {"output": json.dumps(flat)}

    logger.warning("Unknown merge_mode %r on node %s; falling back to concat", mode, node.id)
    sep = cfg.separator
    return {"output": sep.join(str(v) for v in flat)}
