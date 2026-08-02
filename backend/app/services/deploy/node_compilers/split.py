"""split node compiler."""

from __future__ import annotations

from typing import Dict, List, Tuple

from app.models.graph import GraphNode
from app.services.deploy.shared import _collect_inputs_lines


def compile(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    cfg = node.config
    lines: List[str] = []
    lines.extend(_collect_inputs_lines(node, sources))
    lines.append("_source = next(iter(_inputs.values()), '')")
    lines.append(f"_items = str(_source).split({cfg.separator!r}) if _source else []")
    lines.append(f"results[{node.id!r}] = {{'items': _items, 'count': len(_items)}}")
    return lines
