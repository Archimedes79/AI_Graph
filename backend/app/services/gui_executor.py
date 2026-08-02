"""
GUI-node widget execution.

Computes every widget's output value for a GUI node. Most widget kinds simply
resolve their wired/overridden value (file_open, directory_open, text_window,
chat_window). Display-only widgets with zero output ports (currently only
plot_window) instead optionally run a sandboxed data-transform snippet over
their raw incoming value and write the transformed value back into the
caller's `inputs` dict in place, since they have no output port to carry it
through the graph.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from app.models.graph import GraphNode, GuiWidget, GuiWidgetKind, gui_widget_ports, sync_gui_node_ports
from app.services import code_executor, file_service


def _gui_file_open_output(widget: GuiWidget, inputs: Dict[str, Any]) -> Optional[str]:
    """Resolve a file_open widget's chosen/overridden path (content is read downstream)."""
    raw = inputs.get(f"{widget.id}_in")
    if raw is None:
        raw = widget.value
    if not raw:
        return None
    return str(Path(raw).expanduser().resolve())


def _gui_directory_open_output(widget: GuiWidget, inputs: Dict[str, Any]) -> List[str]:
    """List a directory_open widget's chosen/overridden directory, honoring its extension filter."""
    raw = inputs.get(f"{widget.id}_in")
    if raw is None:
        raw = widget.value
    if not raw:
        return []
    path = str(Path(raw).expanduser().resolve())
    extensions = file_service.parse_extensions_filter(widget.extensions)
    return file_service.list_directory(path, recursive=False, extensions=extensions)


def _gui_text_window_output(widget: GuiWidget, inputs: Dict[str, Any]) -> str:
    """Passthrough: incoming wired value wins, otherwise the widget's own text."""
    raw = inputs.get(f"{widget.id}_in")
    return raw if raw is not None else (widget.value or "")


def _gui_chat_window_output(widget: GuiWidget, inputs: Dict[str, Any]) -> str:
    """
    v1 chat_window is non-interactive: the widget's own `value` (simulated/typed
    message) wins when set, otherwise fall back to the incoming (possibly list,
    since multi=True) wired value, flattened into a single string.
    """
    if widget.value:
        return widget.value
    raw = inputs.get(f"{widget.id}_in")
    if isinstance(raw, list):
        return "\n".join(str(item) for item in raw if item is not None)
    return str(raw) if raw is not None else ""


_GUI_WIDGET_EXECUTORS = {
    GuiWidgetKind.FILE_OPEN: _gui_file_open_output,
    GuiWidgetKind.DIRECTORY_OPEN: _gui_directory_open_output,
    GuiWidgetKind.TEXT_WINDOW: _gui_text_window_output,
    GuiWidgetKind.CHAT_WINDOW: _gui_chat_window_output,
}


async def execute_gui_node(node: GraphNode, inputs: Dict[str, Any]) -> Dict[str, Any]:
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
        executor = _GUI_WIDGET_EXECUTORS.get(widget.kind)
        if executor is None:
            raise ValueError(f"Unknown GUI widget kind: {widget.kind}")
        result[f"{widget.id}_out"] = executor(widget, inputs)
    return result
