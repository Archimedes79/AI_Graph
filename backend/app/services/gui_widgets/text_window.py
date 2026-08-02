"""text_window GUI widget executor."""

from __future__ import annotations

from typing import Any, Dict

from app.models.graph import GuiWidget


def execute(widget: GuiWidget, inputs: Dict[str, Any]) -> str:
    """Passthrough: incoming wired value wins, otherwise the widget's own text."""
    raw = inputs.get(f"{widget.id}_in")
    return raw if raw is not None else (widget.value or "")
