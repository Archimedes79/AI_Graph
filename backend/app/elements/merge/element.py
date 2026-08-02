"""The `merge` node element: combine multiple inputs via concat/sum/count/json_list."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services.deploy.shared import collect_inputs_lines, _flatten_merge_values_lines, _flatten_values_lines

logger = logging.getLogger(__name__)


class MergeElement(NodeElement):
    node_type = NodeType.MERGE

    async def execute(
        self,
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

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        lines: List[str] = []
        lines.extend(collect_inputs_lines(node, sources))
        mode = cfg.merge_mode
        if mode == "sum":
            lines.extend(_flatten_merge_values_lines("_inputs", "_flat"))
            lines.append("_total = sum(float(_x) for _x in _flat)")
            lines.append("_total = int(_total) if _total.is_integer() else _total")
            lines.append(f"results[{node.id!r}] = {{'output': _total}}")
        elif mode == "count":
            lines.extend(_flatten_merge_values_lines("_inputs", "_flat"))
            lines.append(f"results[{node.id!r}] = {{'output': len(_flat)}}")
        elif mode == "json_list":
            lines.extend(_flatten_merge_values_lines("_inputs", "_flat"))
            lines.append(f"results[{node.id!r}] = {{'output': json.dumps(_flat)}}")
        else:
            lines.extend(_flatten_values_lines("_inputs", "_parts"))
            lines.append(f"results[{node.id!r}] = {{'output': {cfg.separator!r}.join(_parts)}}")
        return lines
