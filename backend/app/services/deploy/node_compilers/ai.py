"""ai node compiler."""

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
        lines.append(r'_prompt = "\n\n".join(str(_v) for _v in _inputs.values() if _v is not None)')
        lines.append(
            "_output = await _ai_complete(_prompt, "
            f"system={cfg.system_prompt!r}, model={cfg.ai_model!r}, "
            f"temperature={cfg.temperature!r}, provider={cfg.ai_provider.value!r})"
        )
        lines.append(f"results[{node.id!r}] = _reconcile_outputs({output_port_ids!r}, {{'output': _output}})")
    else:
        lines.append(
            f"results[{node.id!r}] = await _ai_complete_batch(_inputs, "
            f"system={cfg.system_prompt!r}, model={cfg.ai_model!r}, "
            f"temperature={cfg.temperature!r}, provider={cfg.ai_provider.value!r}, "
            f"output_port_ids={output_port_ids!r}, multi_port_ids={multi_port_ids!r})"
        )
    return lines
