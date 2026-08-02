"""The `text_output` node element: passthrough, displayed in a text window."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services.deploy.shared import collect_inputs_lines, _flatten_values_lines


class TextOutputElement(NodeElement):
    node_type = NodeType.TEXT_OUTPUT

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        # Passthrough – the frontend/CLI/runner display these inputs in a text window
        return dict(inputs)

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        lines: List[str] = []
        lines.extend(collect_inputs_lines(node, sources))
        lines.append(f"results[{node.id!r}] = dict(_inputs)")
        lines.extend(_flatten_values_lines("_inputs", "_parts"))
        label = cfg.output_label or node.label
        lines.append(f"_text_windows.append({{'label': {label!r}, 'content': chr(10).join(_parts)}})")
        return lines
