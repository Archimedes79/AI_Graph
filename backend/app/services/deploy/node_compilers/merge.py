"""merge node compiler."""

from __future__ import annotations

from typing import Dict, List, Tuple

from app.models.graph import GraphNode
from app.services.deploy.shared import _collect_inputs_lines, _flatten_merge_values_lines, _flatten_values_lines


def compile(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    cfg = node.config
    lines: List[str] = []
    lines.extend(_collect_inputs_lines(node, sources))
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
