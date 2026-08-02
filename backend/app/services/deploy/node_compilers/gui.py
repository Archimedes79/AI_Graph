"""gui node compiler: dispatches each widget to its per-kind gui_widget_compiler."""

from __future__ import annotations

from typing import Dict, List, Tuple

from app.models.graph import GraphNode
from app.services.deploy.gui_widget_compilers import GUI_WIDGET_COMPILERS
from app.services.deploy.shared import _collect_inputs_lines


def compile(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    lines: List[str] = []
    lines.extend(_collect_inputs_lines(node, sources))
    lines.append("_gui_result = {}")
    for widget in node.config.gui_widgets:
        widget_compiler = GUI_WIDGET_COMPILERS.get(widget.kind)
        if widget_compiler is None:
            raise ValueError(f"Unknown GUI widget kind: {widget.kind}")
        lines.extend(widget_compiler(node, widget))
    lines.append(f"results[{node.id!r}] = _gui_result")
    return lines
