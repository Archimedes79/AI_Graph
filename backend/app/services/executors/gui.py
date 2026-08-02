"""gui node executor: dispatches each widget to its per-kind gui_widgets executor."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.models.graph import GraphNode, gui_widget_ports, sync_gui_node_ports
from app.services import code_executor
from app.services.gui_widgets import GUI_WIDGET_EXECUTORS


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    """Compute every widget's output value for a GUI node."""
    sync_gui_node_ports(node)  # defensive: ports must reflect the current widget list
    result: Dict[str, Any] = {}
    for widget in node.config.gui_widgets:
        # Display-only widgets (e.g. plot_window) declare no output port and
        # therefore need no executor -- there is nothing to emit for them. If
        # a transform snippet is configured, run it over the raw incoming
        # value and overwrite it in place so the node's captured inputs (its
        # only visible record, since there is no downstream port) show the
        # plot-ready value instead of the raw one.
        _, widget_outputs = gui_widget_ports(widget)
        if not widget_outputs:
            if widget.code:
                in_id = f"{widget.id}_in"
                raw_value = inputs.get(in_id)
                transformed = await code_executor.execute_code(
                    widget.code, widget.language, {"value": raw_value}
                )
                inputs[in_id] = transformed.get("value", raw_value)
            continue
        executor = GUI_WIDGET_EXECUTORS.get(widget.kind)
        if executor is None:
            raise ValueError(f"Unknown GUI widget kind: {widget.kind}")
        result[f"{widget.id}_out"] = executor(widget, inputs)
    return result
