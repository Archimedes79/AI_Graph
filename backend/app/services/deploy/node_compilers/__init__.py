"""Registry mapping each NodeType to its per-type deploy-script line compiler."""

from __future__ import annotations

from typing import Callable, Dict, List, Tuple

from app.models.graph import GraphNode, NodeType
from app.services.deploy.node_compilers import (
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

NODE_COMPILERS: Dict[NodeType, Callable[..., List[str]]] = {
    NodeType.TEXT_INPUT: text_input.compile,
    NodeType.FILE_INPUT: file_input.compile,
    NodeType.DIRECTORY_INPUT: directory_input.compile,
    NodeType.AI: ai.compile,
    NodeType.CODE: code.compile,
    NodeType.OUTPUT: output.compile,
    NodeType.TEXT_OUTPUT: text_output.compile,
    NodeType.MERGE: merge.compile,
    NodeType.SPLIT: split.compile,
    NodeType.GUI: gui.compile,
}


def compile_node(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    """Generate the executable lines for a single node. Assumes `results` and `_resolved` exist."""
    nt = node.node_type
    compiler = NODE_COMPILERS.get(nt)
    if compiler is None:
        raise ValueError(f"Unknown node type: {nt}")
    lines = [f"# Node: {node.label} ({nt.value})"]
    lines.extend(compiler(node, sources, node_map))
    return lines
