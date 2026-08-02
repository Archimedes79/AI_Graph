"""The `split` node element: split a single text value into a list of items."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services.deploy.shared import collect_inputs_lines


class SplitElement(NodeElement):
    node_type = NodeType.SPLIT

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        sep = cfg.separator
        source = next(iter(inputs.values()), "")
        parts = str(source).split(sep) if source else []
        return {"items": parts, "count": len(parts)}

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        lines: List[str] = []
        lines.extend(collect_inputs_lines(node, sources))
        lines.append("_source = next(iter(_inputs.values()), '')")
        lines.append(f"_items = str(_source).split({cfg.separator!r}) if _source else []")
        lines.append(f"results[{node.id!r}] = {{'items': _items, 'count': len(_items)}}")
        return lines
