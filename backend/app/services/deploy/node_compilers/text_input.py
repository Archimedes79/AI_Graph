"""text_input node compiler."""

from __future__ import annotations

from typing import Dict, List, Tuple

from app.models.graph import GraphNode


def compile(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    cfg = node.config
    return [f"results[{node.id!r}] = {{'output': _resolved.get({node.id!r}, {(cfg.value or '')!r})}}"]
