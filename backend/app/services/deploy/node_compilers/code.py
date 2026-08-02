"""code node compiler."""

from __future__ import annotations

from typing import Dict, List, Tuple

from app.models.graph import GraphNode
from app.services.deploy.shared import _collect_inputs_lines, _resolve_file_inputs_lines


def compile(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    cfg = node.config
    lines: List[str] = []
    lines.extend(_collect_inputs_lines(node, sources))
    lines.extend(_resolve_file_inputs_lines(node, sources, node_map))
    output_port_ids = [p.id for p in node.outputs]
    multi_port_ids = [p.id for p in node.outputs if p.multi]
    if cfg.batch_mode == "whole_list":
        lines.append(f"_raw = await _run_code({cfg.code!r}, {(cfg.language or 'python')!r}, _inputs)")
        lines.append(f"results[{node.id!r}] = _reconcile_outputs({output_port_ids!r}, _raw)")
    else:
        lines.append(
            f"results[{node.id!r}] = await _run_code_batch({cfg.code!r}, {(cfg.language or 'python')!r}, "
            f"_inputs, {output_port_ids!r}, {multi_port_ids!r})"
        )
    return lines
