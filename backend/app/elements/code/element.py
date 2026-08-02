"""The `code` node element: run user/AI-written Python or JavaScript against its inputs.

Reference implementation for AGENTS.md's element contract -- every other
NodeElement should look structurally identical to this one.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services import code_executor
from app.services.batching import reconcile_outputs
from app.services.deploy.shared import collect_inputs_lines, resolve_file_inputs_lines


class CodeElement(NodeElement):
    node_type = NodeType.CODE

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        result = await code_executor.execute_code(cfg.code, cfg.language, inputs)
        return reconcile_outputs(node, result)

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        lines: List[str] = []
        lines.extend(collect_inputs_lines(node, sources))
        lines.extend(resolve_file_inputs_lines(node, sources, node_map))
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
