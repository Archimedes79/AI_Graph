"""
The `output` node element: passthrough plus optional file/directory write, or
display in a text window (`write_mode == "window"`, the former standalone
`text_output` node type -- see AGENTS.md's legacy-name conventions).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.elements.base import DeployNeeds, NodeElement
from app.models.graph import GraphNode, NodeType
from app.services import file_service


def effective_write_mode(node: GraphNode) -> str:
    """A legacy TEXT_OUTPUT node always displays in a window, matching the
    former TextOutputElement, regardless of its config's write_mode (which
    only applies to the unified `output` node_type -- same convention as
    InputElement._effective_mode for the legacy input node types)."""
    if node.node_type == NodeType.TEXT_OUTPUT:
        return "window"
    return node.config.write_mode


class OutputElement(NodeElement):
    # Handles: NodeType.OUTPUT, NodeType.TEXT_OUTPUT
    node_type = NodeType.OUTPUT

    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        cfg = node.config
        # The "path" port lets an upstream node supply the write target at
        # runtime; it always wins over the config-time value when wired.
        path_input = inputs.get("path")
        target = file_service.resolve_path(path_input) if path_input else cfg.value
        value_inputs = {k: v for k, v in inputs.items() if k != "path"}
        result = dict(value_inputs)
        fmt_map = {k: v for k, v in (effective_formats or {}).items() if k != "path"}
        non_null_items = [(k, v) for k, v in value_inputs.items() if v is not None]

        if cfg.write_mode == "file" and target:
            if len(non_null_items) == 1:
                key, value = non_null_items[0]
                fmt = fmt_map.get(key)
                if fmt and fmt.lower() != "text":
                    written = file_service.write_formatted_file(target, value, fmt)
                else:
                    written = file_service.write_file(target, str(value), mode="text")
            else:
                # Multiple ports/values: join as text unless they all share one
                # explicit non-text format, in which case write them as a JSON array.
                shared_formats = {(fmt_map.get(k) or "text").lower() for k, _ in non_null_items}
                if non_null_items and len(shared_formats) == 1 and next(iter(shared_formats)) != "text":
                    fmt = fmt_map.get(non_null_items[0][0])
                    written = file_service.write_formatted_file(
                        target, [v for _, v in non_null_items], fmt
                    )
                else:
                    content = "\n".join(str(v) for v in value_inputs.values() if v is not None)
                    written = file_service.write_file(target, content, mode="text")
            result["written_path"] = written
        elif cfg.write_mode == "directory" and target:
            multi_ports = {port.id for port in node.inputs if port.multi}
            written = file_service.write_batch(target, value_inputs, fmt_map, multi_ports)
            result["written_paths"] = written
        return result

    def runtime_requirements(self, node: GraphNode) -> List[Dict[str, Any]]:
        cfg = node.config
        mode = effective_write_mode(node)
        if cfg.prompt_at_runtime and mode in ("file", "directory"):
            return [{
                "node_id": node.id, "label": node.label, "kind": mode,
                "direction": "output", "current_value": cfg.value or "",
            }]
        return []

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        # Matches the pre-refactor check exactly: any file/directory-writing
        # OUTPUT node pulls in the file helpers; "window" mode (the former
        # TextOutputElement) needs nothing extra, same as before the merge.
        return DeployNeeds(files=effective_write_mode(node) in ("file", "directory"))
