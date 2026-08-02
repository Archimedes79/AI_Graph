"""output node executor."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.models.graph import GraphNode
from app.services import file_service


async def execute(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    cfg = node.config
    result = dict(inputs)
    fmt_map = effective_formats or {}
    non_null_items = [(k, v) for k, v in inputs.items() if v is not None]

    if cfg.write_mode == "file" and cfg.value:
        if len(non_null_items) == 1:
            key, value = non_null_items[0]
            fmt = fmt_map.get(key)
            if fmt and fmt.lower() != "text":
                written = file_service.write_formatted_file(cfg.value, value, fmt)
            else:
                written = file_service.write_text_file(cfg.value, str(value))
        else:
            # Multiple ports/values: join as text unless they all share one
            # explicit non-text format, in which case write them as a JSON array.
            shared_formats = {(fmt_map.get(k) or "text").lower() for k, _ in non_null_items}
            if non_null_items and len(shared_formats) == 1 and next(iter(shared_formats)) != "text":
                fmt = fmt_map.get(non_null_items[0][0])
                written = file_service.write_formatted_file(
                    cfg.value, [v for _, v in non_null_items], fmt
                )
            else:
                content = "\n".join(str(v) for v in inputs.values() if v is not None)
                written = file_service.write_text_file(cfg.value, content)
        result["written_path"] = written
    elif cfg.write_mode == "directory" and cfg.value:
        multi_ports = {port.id for port in node.inputs if port.multi}
        written = file_service.write_output_directory(cfg.value, inputs, fmt_map, multi_ports)
        result["written_paths"] = written
    return result
