"""Registry mapping each NodeType to its per-type node executor."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from app.models.graph import GraphNode, NodeType
from app.services.executors import (
    ai,
    code,
    directory_input,
    file_input,
    gui,
    merge,
    output,
    split,
    text_input,
    text_output,
)

NODE_EXECUTORS: Dict[NodeType, Callable[..., Any]] = {
    NodeType.TEXT_INPUT: text_input.execute,
    NodeType.FILE_INPUT: file_input.execute,
    NodeType.DIRECTORY_INPUT: directory_input.execute,
    NodeType.AI: ai.execute,
    NodeType.CODE: code.execute,
    NodeType.OUTPUT: output.execute,
    NodeType.TEXT_OUTPUT: text_output.execute,
    NodeType.MERGE: merge.execute,
    NodeType.SPLIT: split.execute,
    NodeType.GUI: gui.execute,
}


async def execute_node(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    """Execute a single node and return its output dict."""
    nt = node.node_type
    executor = NODE_EXECUTORS.get(nt)
    if executor is None:
        raise ValueError(f"Unknown node type: {nt}")
    return await executor(node, inputs, effective_formats)
