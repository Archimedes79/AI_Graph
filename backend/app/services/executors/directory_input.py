"""directory_input node executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from app.models.graph import GraphNode
from app.services import ai_service, code_executor, file_service


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    path = str(Path(cfg.value or inputs.get("path", "")).expanduser().resolve())
    recursive = cfg.extra.get("recursive", False)
    extensions = file_service.parse_extensions_filter(cfg.extra.get("extensions", ""))
    files = file_service.list_directory(path, recursive=recursive, extensions=extensions)
    selector_code = cfg.selector_code.strip()
    if not cfg.select_all_files and not selector_code and cfg.selector_prompt.strip():
        selector_code, _ = await ai_service.generate_code(
            description=cfg.selector_prompt,
            language=cfg.language or "python",
            context='inputs["files"] contains rooted file paths. Return {"files": [...]} with selected paths.',
            inputs=["files"],
            outputs=["files"],
            model=cfg.ai_model,
            provider=cfg.ai_provider,
        )
    if not cfg.select_all_files and selector_code:
        selected = await code_executor.execute_code(
            selector_code, cfg.language or "python", {"files": files}
        )
        files = selected.get("files", files)
    return {"files": files, "count": len(files)}
