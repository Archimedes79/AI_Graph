"""text_output node compiler."""

from __future__ import annotations

from typing import Dict, List, Tuple

from app.models.graph import GraphNode
from app.services.deploy.shared import _collect_inputs_lines, _flatten_values_lines


def compile(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    cfg = node.config
    lines: List[str] = []
    lines.extend(_collect_inputs_lines(node, sources))
    lines.append(f"results[{node.id!r}] = dict(_inputs)")
    lines.extend(_flatten_values_lines("_inputs", "_parts"))
    label = cfg.output_label or node.label
    lines.append(f"_text_windows.append({{'label': {label!r}, 'content': chr(10).join(_parts)}})")
    return lines
