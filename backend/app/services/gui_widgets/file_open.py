"""file_open GUI widget executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from app.models.graph import GuiWidget


def execute(widget: GuiWidget, inputs: Dict[str, Any]) -> Optional[str]:
    """Resolve a file_open widget's chosen/overridden path (content is read downstream)."""
    raw = inputs.get(f"{widget.id}_in")
    if raw is None:
        raw = widget.value
    if not raw:
        return None
    return str(Path(raw).expanduser().resolve())
