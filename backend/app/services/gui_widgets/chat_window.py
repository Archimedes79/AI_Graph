"""chat_window GUI widget executor."""

from __future__ import annotations

from typing import Any, Dict

from app.models.graph import GuiWidget


def execute(widget: GuiWidget, inputs: Dict[str, Any]) -> str:
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
