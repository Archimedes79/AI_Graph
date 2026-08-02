"""output node compiler."""

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
    lines.append(f"results[{node.id!r}] = dict(_inputs)")
    if cfg.write_mode in ("file", "directory"):
        lines.append(f"_out_path = _resolved.get({node.id!r}, {(cfg.value or '')!r})")
        lines.append("if _out_path:")
        if cfg.write_mode == "file":
            lines.append("    _content = '\\n'.join(str(v) for v in _inputs.values() if v is not None)")
            lines.append(f"    results[{node.id!r}]['written_path'] = _write_text_file(_out_path, _content)")
        else:
            lines.append(f"    results[{node.id!r}]['written_paths'] = _write_output_directory(_out_path, _inputs)")
    return lines
