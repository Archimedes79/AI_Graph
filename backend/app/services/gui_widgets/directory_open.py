"""directory_open GUI widget executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from app.models.graph import GuiWidget
from app.services import file_service


def execute(widget: GuiWidget, inputs: Dict[str, Any]) -> List[str]:
    """List a directory_open widget's chosen/overridden directory, honoring its extension filter."""
    raw = inputs.get(f"{widget.id}_in")
    if raw is None:
        raw = widget.value
    if not raw:
        return []
    path = str(Path(raw).expanduser().resolve())
    extensions = file_service.parse_extensions_filter(widget.extensions)
    return file_service.list_directory(path, recursive=False, extensions=extensions)
