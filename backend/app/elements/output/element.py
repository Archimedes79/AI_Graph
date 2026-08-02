"""The `output` node element: passthrough plus optional file/directory write."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import NodeElement, NodeMap, Sources
from app.models.graph import GraphNode, NodeType
from app.services import file_service
from app.services.deploy.shared import collect_inputs_lines


class OutputElement(NodeElement):
    node_type = NodeType.OUTPUT

    async def execute(
        self,
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

    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        cfg = node.config
        lines: List[str] = []
        lines.extend(collect_inputs_lines(node, sources))
        lines.append(f"results[{node.id!r}] = dict(_inputs)")
        if cfg.write_mode in ("file", "directory"):
            lines.append(f"_out_path = _resolved.get({node.id!r}, {(cfg.value or '')!r})")
            lines.append("if _out_path:")
            if cfg.write_mode == "file":
                lines.append("    _content = '\\n'.join(str(v) for v in _inputs.values() if v is not None)")
                lines.append(f"    results[{node.id!r}]['written_path'] = _write_text_file(_out_path, _content)")
            else:
                lines.append(f"    results[{node.id!r}]['written_paths'] = _write_output_directory(_out_path, _inputs)")
        return lines
