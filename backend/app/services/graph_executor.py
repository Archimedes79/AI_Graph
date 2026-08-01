"""
Graph execution engine.

Performs a topological traversal of the graph and executes each node,
passing output values along the edges to downstream node inputs.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from typing import Any, Dict, List, Optional

from app.models.graph import (
    DataType,
    ExecutionResult,
    ExecutionStatus,
    Graph,
    GraphEdge,
    GraphNode,
    NodeResult,
    NodeType,
    RuntimeRequirement,
)
from app.services import ai_service, code_executor, file_service

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _topological_sort(nodes: List[GraphNode], edges: List[GraphEdge]) -> List[str]:
    """
    Return node IDs in topological execution order.
    Raises ValueError if a cycle is detected.
    """
    node_ids = {n.id for n in nodes}
    in_degree: Dict[str, int] = {nid: 0 for nid in node_ids}
    successors: Dict[str, List[str]] = defaultdict(list)

    for edge in edges:
        if edge.source_node_id in node_ids and edge.target_node_id in node_ids:
            in_degree[edge.target_node_id] += 1
            successors[edge.source_node_id].append(edge.target_node_id)

    queue: deque[str] = deque(
        nid for nid, deg in in_degree.items() if deg == 0
    )
    order: List[str] = []
    while queue:
        nid = queue.popleft()
        order.append(nid)
        for succ in successors[nid]:
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if len(order) != len(node_ids):
        raise ValueError("Graph contains a cycle; execution is not possible.")
    return order


def _collect_inputs(
    node_id: str,
    edges: List[GraphEdge],
    node_outputs: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Gather all upstream output values that are wired into *node_id*'s input ports.
    Multi-input ports accumulate values into a list.
    """
    collected: Dict[str, Any] = {}
    for edge in edges:
        if edge.target_node_id != node_id:
            continue
        value = node_outputs.get(edge.source_node_id, {}).get(edge.source_port_id)
        target_port = edge.target_port_id
        if target_port in collected:
            existing = collected[target_port]
            if isinstance(existing, list):
                existing.append(value)
            else:
                collected[target_port] = [existing, value]
        else:
            collected[target_port] = value
    return collected


# ---------------------------------------------------------------------------
# Individual node executors
# ---------------------------------------------------------------------------

async def _execute_node(
    node: GraphNode,
    inputs: Dict[str, Any],
) -> Dict[str, Any]:
    """Execute a single node and return its output dict."""
    cfg = node.config
    nt = node.node_type

    if nt == NodeType.TEXT_INPUT:
        return {"output": cfg.value or inputs.get("value", "")}

    if nt == NodeType.FILE_INPUT:
        path = cfg.value or inputs.get("path", "")
        content = file_service.read_text_file(path)
        return {"content": content, "path": path}

    if nt == NodeType.DIRECTORY_INPUT:
        path = cfg.value or inputs.get("path", "")
        recursive = cfg.extra.get("recursive", False)
        files = file_service.list_directory(path, recursive=recursive)
        if not cfg.select_all_files and cfg.selector_code.strip():
            selected = await code_executor.execute_code(
                cfg.selector_code, cfg.language or "python", {"files": files}
            )
            files = selected.get("files", files)
        return {"files": files, "count": len(files)}

    if nt == NodeType.AI:
        prompt_parts = []
        for port_id, val in inputs.items():
            if val is not None:
                prompt_parts.append(str(val) if not isinstance(val, str) else val)
        prompt = "\n\n".join(prompt_parts)
        response = await ai_service.complete(
            prompt=prompt,
            system=cfg.system_prompt,
            model=cfg.ai_model,
            temperature=cfg.temperature,
            provider=cfg.ai_provider,
        )
        return {"output": response}

    if nt == NodeType.CODE:
        result = await code_executor.execute_code(cfg.code, cfg.language, inputs)
        return result

    if nt == NodeType.OUTPUT:
        result = dict(inputs)
        if cfg.write_mode == "file" and cfg.value:
            content = "\n".join(str(v) for v in inputs.values() if v is not None)
            written = file_service.write_text_file(cfg.value, content)
            result["written_path"] = written
        elif cfg.write_mode == "directory" and cfg.value:
            written = file_service.write_output_directory(cfg.value, inputs)
            result["written_paths"] = written
        return result

    if nt == NodeType.TEXT_OUTPUT:
        # Passthrough – the frontend/CLI/runner display these inputs in a text window
        return dict(inputs)

    if nt == NodeType.MERGE:
        sep = cfg.separator
        parts = []
        for val in inputs.values():
            if isinstance(val, list):
                parts.extend(str(v) for v in val)
            elif val is not None:
                parts.append(str(val))
        return {"output": sep.join(parts)}

    if nt == NodeType.SPLIT:
        sep = cfg.separator
        source = next(iter(inputs.values()), "")
        parts = str(source).split(sep) if source else []
        return {"items": parts, "count": len(parts)}

    raise ValueError(f"Unknown node type: {nt}")


# ---------------------------------------------------------------------------
# Graph executor
# ---------------------------------------------------------------------------

async def execute_graph(graph: Graph) -> ExecutionResult:
    """
    Execute the full graph and return an ExecutionResult.
    """
    start = time.monotonic()
    node_map = {n.id: n for n in graph.nodes}

    try:
        order = _topological_sort(graph.nodes, graph.edges)
    except ValueError as exc:
        return ExecutionResult(
            status=ExecutionStatus.ERROR,
            error=str(exc),
            duration_ms=(time.monotonic() - start) * 1000,
        )

    node_outputs: Dict[str, Dict[str, Any]] = {}
    node_results: List[NodeResult] = []

    for node_id in order:
        node = node_map[node_id]
        inputs = _collect_inputs(node_id, graph.edges, node_outputs)
        node_start = time.monotonic()
        try:
            outputs = await _execute_node(node, inputs)
            node_outputs[node_id] = outputs
            node_results.append(
                NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.SUCCESS,
                    outputs=outputs,
                    duration_ms=(time.monotonic() - node_start) * 1000,
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error executing node %s", node_id)
            node_results.append(
                NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.ERROR,
                    error=str(exc),
                    duration_ms=(time.monotonic() - node_start) * 1000,
                )
            )
            # Continue to remaining nodes so the caller sees full status

    # Collect outputs of OUTPUT nodes as the final result
    final_outputs: Dict[str, Any] = {}
    for node in graph.nodes:
        if node.node_type in (NodeType.OUTPUT, NodeType.TEXT_OUTPUT) and node.id in node_outputs:
            final_outputs[node.config.output_label or node.id] = node_outputs[node.id]

    has_error = any(r.status == ExecutionStatus.ERROR for r in node_results)
    return ExecutionResult(
        status=ExecutionStatus.ERROR if has_error else ExecutionStatus.SUCCESS,
        node_results=node_results,
        final_outputs=final_outputs,
        duration_ms=(time.monotonic() - start) * 1000,
    )


# ---------------------------------------------------------------------------
# Runtime prompting – used by the web UI (via requirements + manual apply),
# the graph-runner CLI, and the generated deployment runner script.
# ---------------------------------------------------------------------------

_INPUT_NODE_KINDS = {
    NodeType.TEXT_INPUT: "text",
    NodeType.FILE_INPUT: "file",
    NodeType.DIRECTORY_INPUT: "directory",
}


def get_runtime_requirements(graph: Graph) -> List[RuntimeRequirement]:
    """
    Inspect the graph for input nodes (text/file/directory) which always prompt
    the user via a dialog before execution, plus output nodes flagged with
    `prompt_at_runtime`. Returns the list of values that must be supplied.
    """
    requirements: List[RuntimeRequirement] = []
    for node in graph.nodes:
        cfg = node.config
        kind = _INPUT_NODE_KINDS.get(node.node_type)
        if kind is not None:
            requirements.append(
                RuntimeRequirement(
                    node_id=node.id, label=node.label, kind=kind,
                    direction="input", current_value=cfg.value or "",
                )
            )
        elif node.node_type == NodeType.OUTPUT and cfg.prompt_at_runtime and cfg.write_mode != "none":
            requirements.append(
                RuntimeRequirement(
                    node_id=node.id, label=node.label, kind=cfg.write_mode,
                    direction="output", current_value=cfg.value or "",
                )
            )
    return requirements


def apply_runtime_values(graph: Graph, values: Dict[str, str]) -> None:
    """Apply resolved node_id -> path values onto the graph in place."""
    node_map = {n.id: n for n in graph.nodes}
    for node_id, value in values.items():
        node = node_map.get(node_id)
        if node is not None:
            node.config.value = value


def get_text_output_windows(graph: Graph, result: ExecutionResult) -> List[Dict[str, str]]:
    """
    Collect the rendered content of every TEXT_OUTPUT node so it can be shown
    to the user (web modal, or printed to the console for CLI/deployed runs).
    """
    results_by_id = {r.node_id: r for r in result.node_results}
    windows: List[Dict[str, str]] = []
    for node in graph.nodes:
        if node.node_type != NodeType.TEXT_OUTPUT:
            continue
        node_result = results_by_id.get(node.id)
        if node_result is None or node_result.status != ExecutionStatus.SUCCESS:
            continue
        parts: List[str] = []
        for value in node_result.outputs.values():
            if isinstance(value, list):
                parts.extend(str(v) for v in value)
            elif value is not None:
                parts.append(str(value))
        windows.append(
            {
                "node_id": node.id,
                "label": node.config.output_label or node.label,
                "content": "\n".join(parts),
            }
        )
    return windows
