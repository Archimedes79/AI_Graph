"""file_input node executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from app.models.graph import GraphNode
from app.services import file_service


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    path = str(Path(cfg.value or inputs.get("path", "")).expanduser().resolve())
    content = file_service.read_text_file(path)
    return {"content": content, "path": path}
