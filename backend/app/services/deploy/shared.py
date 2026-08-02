"""Shared line-generation helpers used by multiple node compilers."""

from __future__ import annotations

import ast
import inspect
from types import ModuleType
from typing import Dict, List, Tuple

from app.models.graph import DataType, GraphNode

# Sentinel source-node ids standing in for a deferred (t+1) edge, which has no
# current-round producer to read from. DEFERRED_LITERAL pairs with a ready-made
# Python expression for the edge's initial value; DEFERRED_EMPTY contributes no
# value at all (the port stays unpopulated, exactly like an unwired port).
DEFERRED_LITERAL = "__deferred_literal__"
DEFERRED_EMPTY = "__deferred_empty__"


def extract_source(module: ModuleType, names: List[str]) -> str:
    """
    Return the literal source text of specific top-level statements (constant
    assignments or function defs) named in *names*, from *module*, in that
    order, joined by blank lines.

    This is how deploy_service.py embeds real, portable functions (from
    file_service.py / batching.py / code_executor.py / ai_service.py) into the
    compiled runner script verbatim -- not a hand-copied string literal that
    merely resembles the real implementation -- so the deployed bundle stays
    byte-identical in behavior to live execution; a fix to one of those
    functions is picked up here automatically, it can never silently drift.
    """
    source = inspect.getsource(module)
    tree = ast.parse(source)
    blocks: Dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            blocks[node.name] = ast.get_source_segment(source, node)
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            blocks[node.targets[0].id] = ast.get_source_segment(source, node)
    missing = [name for name in names if name not in blocks]
    if missing:
        raise ValueError(f"extract_source: {missing!r} not found as top-level statements in {module.__name__}")
    return "\n\n\n".join(blocks[name] for name in names)


def collect_inputs_lines(node: GraphNode, sources: Dict[Tuple[str, str], List[Tuple[str, str]]]) -> List[str]:
    """Generate the lines that build `_inputs` for *node* from upstream results."""
    lines = ["_inputs = {}"]
    for port in node.inputs:
        srcs = sources.get((node.id, port.id), [])
        if not srcs:
            continue
        exprs = [
            sport if sid == DEFERRED_LITERAL else f"results[{sid!r}][{sport!r}]"
            for sid, sport in srcs
            if sid != DEFERRED_EMPTY
        ]
        if len(srcs) > 1:
            lines.append(f"_inputs[{port.id!r}] = [{', '.join(exprs)}]")
        elif exprs:
            lines.append(f"_inputs[{port.id!r}] = {exprs[0]}")
    return lines


def effective_format(
    node: GraphNode,
    port_id: str,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> str:
    """
    Own format on the port wins; otherwise fall back to the format declared on the
    upstream source port(s) wired into it, mirroring graph_executor._effective_input_format.
    """
    port = next((p for p in node.inputs if p.id == port_id), None)
    if port is not None and port.format:
        return port.format
    for source_node_id, source_port_id in sources.get((node.id, port_id), []):
        source_node = node_map.get(source_node_id)
        if source_node is None:
            continue
        source_port = next((p for p in source_node.outputs if p.id == source_port_id), None)
        if source_port is not None and source_port.format:
            return source_port.format
    return ""


def resolve_file_inputs_lines(
    node: GraphNode,
    sources: Dict[Tuple[str, str], List[Tuple[str, str]]],
    node_map: Dict[str, GraphNode],
) -> List[str]:
    """Lines that swap file_path input values for their content when `read_file_inputs` is set."""
    if not node.config.read_file_inputs:
        return []
    file_ports = {
        port.id: effective_format(node, port.id, sources, node_map)
        for port in node.inputs if port.data_type == DataType.FILE_PATH
    }
    return [f"_inputs = _resolve_file_inputs(_inputs, {file_ports!r})"]


def _flatten_values_lines(inputs_var: str, out_var: str) -> List[str]:
    """Lines that flatten a dict-of-values (lists expand, scalars stringify) into a list of strings."""
    return [
        f"{out_var} = []",
        f"for _v in {inputs_var}.values():",
        "    if isinstance(_v, list):",
        f"        {out_var}.extend(str(x) for x in _v)",
        "    elif _v is not None:",
        f"        {out_var}.append(str(_v))",
    ]


def _flatten_merge_values_lines(inputs_var: str, out_var: str) -> List[str]:
    """Lines that flatten a dict-of-values (lists expand, None dropped) for sum/count/json_list merge modes."""
    return [
        f"{out_var} = []",
        f"for _v in {inputs_var}.values():",
        "    if isinstance(_v, list):",
        f"        {out_var}.extend(_x for _x in _v if _x is not None)",
        "    elif _v is not None:",
        f"        {out_var}.append(_v)",
    ]
