"""
Graph execution engine.

Performs a topological traversal of the graph and executes each node,
passing output values along the edges to downstream node inputs.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.models.graph import (
    DataType,
    ExecutionResult,
    ExecutionStatus,
    Graph,
    GraphEdge,
    GraphNode,
    GuiWidgetKind,
    NodeResult,
    NodeType,
    RuntimeRequirement,
    sync_gui_node_ports,
)
from app.elements.registry import NODE_ELEMENTS
from app.services import ai_service, file_service  # ai_service: tests monkeypatch this module attribute
from app.services.batching import batch_inputs, merge_batch_outputs

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _topological_sort(nodes: List[GraphNode], edges: List[GraphEdge]) -> List[str]:
    """
    Return node IDs in topological execution order.
    Deferred (t+1) edges carry a value from the previous round, so they impose no
    ordering constraint and are ignored here.
    Raises ValueError if a cycle is detected.
    """
    node_ids = {n.id for n in nodes}
    in_degree: Dict[str, int] = {nid: 0 for nid in node_ids}
    successors: Dict[str, List[str]] = defaultdict(list)

    for edge in edges:
        if edge.deferred:
            continue
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
    previous_outputs: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Gather all upstream output values that are wired into *node_id*'s input ports.
    Multi-input ports accumulate values into a list. A port fed by more than one
    edge always collects as a list, even if some of its sources failed/were
    skipped -- those contribute nothing (not a `None` placeholder) so surviving
    values aren't diluted, while a single edge whose source failed still yields
    no entry at all (as opposed to a `None` value from a source that legitimately
    succeeded with `None`).

    A deferred (t+1) edge reads its source from *previous_outputs* instead of the
    current round's *node_outputs*. With no previous value it falls back to the
    edge's `initial_value`, and contributes nothing at all when that is None.
    """
    port_edges: Dict[str, List[GraphEdge]] = defaultdict(list)
    for edge in edges:
        if edge.target_node_id == node_id:
            port_edges[edge.target_port_id].append(edge)

    collected: Dict[str, Any] = {}
    for target_port, incoming in port_edges.items():
        values = []
        for edge in incoming:
            outputs = previous_outputs if edge.deferred else node_outputs
            source_outputs = (outputs or {}).get(edge.source_node_id)
            if source_outputs is None:
                if edge.deferred and edge.initial_value is not None:
                    values.append(edge.initial_value)
                continue
            values.append(source_outputs.get(edge.source_port_id))
        if len(incoming) > 1:
            collected[target_port] = values
        elif values:
            collected[target_port] = values[0]
    return collected


def _collect_input_source_formats(
    node_id: str,
    edges: List[GraphEdge],
    node_map: Dict[str, GraphNode],
) -> Dict[str, List[Optional[str]]]:
    """
    Mirror _collect_inputs' per-port accumulation order, but record each
    contributing edge's source-port format instead of its value. Lets a
    multi-input port fed by several edges decode each value with its own
    upstream format instead of one uniform port-level format.
    """
    formats: Dict[str, List[Optional[str]]] = defaultdict(list)
    for edge in edges:
        if edge.target_node_id != node_id:
            continue
        source_node = node_map.get(edge.source_node_id)
        source_port = (
            next((p for p in source_node.outputs if p.id == edge.source_port_id), None)
            if source_node is not None
            else None
        )
        formats[edge.target_port_id].append(source_port.format if source_port else None)
    return dict(formats)


def _decode_value(value: Any, format_name: Optional[str]) -> Any:
    """Decode structured connector payloads before a block receives them."""
    if isinstance(value, list):
        return [_decode_value(item, format_name) for item in value]
    if not isinstance(value, str) or not format_name:
        return value
    normalized = format_name.lower()
    if normalized in ("json", "application/json"):
        return json.loads(value)
    if normalized in ("csv", "text/csv"):
        return list(csv.DictReader(io.StringIO(value)))
    return value


def _serialize_debug_value(value: Any, format_name: Optional[str]) -> tuple[str, str]:
    """Serialize a connector snapshot using its declared format."""
    return file_service.serialize_text_value(value, format_name)


def _debug_connector_value(node_id: str, port: Any, value: Any, direction: str, index: int) -> None:
    """Write an optional connector snapshot for runtime inspection."""
    if not port.debug_directory:
        return
    suffix, content = _serialize_debug_value(value, port.format)
    directory = Path(port.debug_directory).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{node_id}_{port.id}_{direction}_{index}{suffix}").write_text(content, encoding="utf-8")


def _read_one(path: str, fmt: Optional[str]) -> str:
    """Resolve a single file path to its content, honoring the declared format."""
    normalized = (fmt or "").lower()
    if normalized.startswith("image/") or normalized in ("binary", "application/octet-stream"):
        return file_service.read_binary_file_base64(path)
    return file_service.read_text_file(path)


def _effective_input_format(
    node: GraphNode,
    port_id: str,
    edges: List[GraphEdge],
    node_map: Dict[str, GraphNode],
) -> Optional[str]:
    """
    Determine the format that applies to one of *node*'s input ports: an explicit
    format on the port itself wins, otherwise fall back to the format declared on
    the upstream source port(s) wired into it via *edges*.
    """
    port = next((p for p in node.inputs if p.id == port_id), None)
    if port is not None and port.format:
        return port.format
    for edge in edges:
        if edge.target_node_id != node.id or edge.target_port_id != port_id:
            continue
        source_node = node_map.get(edge.source_node_id)
        if source_node is None:
            continue
        source_port = next((p for p in source_node.outputs if p.id == edge.source_port_id), None)
        if source_port is not None and source_port.format:
            return source_port.format
    return None


def _effective_input_formats(
    node: GraphNode,
    edges: List[GraphEdge],
    node_map: Dict[str, GraphNode],
) -> Dict[str, Optional[str]]:
    """Compute the effective (own-or-inherited) format for every input port of *node*."""
    return {port.id: _effective_input_format(node, port.id, edges, node_map) for port in node.inputs}


def _resolve_file_inputs(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Dict[str, Optional[str]],
) -> Dict[str, Any]:
    """For code/ai nodes opting in via `read_file_inputs`, replace file_path values with their content."""
    if node.config.read_file_inputs is not True or node.node_type not in (NodeType.CODE, NodeType.AI):
        return inputs

    ports = {port.id: port for port in node.inputs}
    resolved: Dict[str, Any] = {}
    for key, value in inputs.items():
        port = ports.get(key)
        if port is None or port.data_type != DataType.FILE_PATH:
            resolved[key] = value
            continue
        fmt = effective_formats.get(key)
        if isinstance(value, list):
            resolved[key] = [_read_one(item, fmt) if item is not None else None for item in value]
        elif value is None:
            resolved[key] = None
        else:
            resolved[key] = _read_one(value, fmt)
    return resolved


def _decode_node_inputs(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Dict[str, Optional[str]],
    source_formats: Optional[Dict[str, List[Optional[str]]]] = None,
) -> Dict[str, Any]:
    """
    Decode each input port's value using its effective format. When a port has
    no explicit format of its own and is fed by multiple edges (source_formats
    has >1 entry for it), decode each element of the accumulated list with its
    own contributing edge's format rather than one uniform port-level format.
    """
    ports = {port.id: port for port in node.inputs}
    decoded: Dict[str, Any] = {}
    for key, value in inputs.items():
        port = ports.get(key)
        effective_format = effective_formats.get(key)
        per_edge_formats = source_formats.get(key) if source_formats else None
        if (
            port is not None
            and not port.format
            and per_edge_formats is not None
            and len(per_edge_formats) > 1
            and isinstance(value, list)
            and len(per_edge_formats) == len(value)
        ):
            decoded[key] = [_decode_value(item, fmt) for item, fmt in zip(value, per_edge_formats)]
        elif (
            isinstance(value, list)
            and per_edge_formats is not None
            and len(per_edge_formats) == 1
            and effective_format is not None
            and per_edge_formats[0] == effective_format
        ):
            # A single structured upstream edge may already have decoded its own
            # JSON/CSV payload (for example a JSON array). Preserve that list
            # instead of recursively decoding each element again downstream.
            decoded[key] = value
        else:
            decoded[key] = _decode_value(value, effective_format)
    return decoded


def _decode_node_outputs(node: GraphNode, outputs: Dict[str, Any]) -> Dict[str, Any]:
    ports = {port.id: port for port in node.outputs}
    return {key: _decode_value(value, ports.get(key).format if ports.get(key) else None) for key, value in outputs.items()}


def _snapshot_inputs(node: GraphNode, inputs: Dict[str, Any]) -> None:
    for port in node.inputs:
        value = inputs.get(port.id)
        values = value if isinstance(value, list) and port.multi else [value]
        for index, item in enumerate(values):
            _debug_connector_value(node.id, port, item, "in", index)


def _snapshot_outputs(node: GraphNode, outputs: Dict[str, Any]) -> None:
    for port in node.outputs:
        value = outputs.get(port.id)
        values = value if isinstance(value, list) and port.multi else [value]
        for index, item in enumerate(values):
            _debug_connector_value(node.id, port, item, "out", index)


def _blocked_required_port(
    node: GraphNode,
    edges: List[GraphEdge],
    result_by_id: Dict[str, "NodeResult"],
) -> Optional[str]:
    """
    Return the name of a required input port whose wired-in predecessors have
    ALL failed/been skipped (i.e. no successful source remains for that port),
    or None if every required port is still satisfiable. Ports that aren't
    wired to any edge, or that are optional, are never blocking here. Deferred
    (t+1) edges are ignored: their source belongs to the previous round and
    legitimately hasn't run yet in this one.
    """
    incoming_by_port: Dict[str, List[str]] = defaultdict(list)
    for edge in edges:
        if edge.target_node_id == node.id and not edge.deferred:
            incoming_by_port[edge.target_port_id].append(edge.source_node_id)

    for port in node.inputs:
        if not port.required:
            continue
        sources = incoming_by_port.get(port.id)
        if not sources:
            continue
        if not any(
            result_by_id.get(
                source_id, NodeResult(node_id=source_id, status=ExecutionStatus.PENDING)
            ).status == ExecutionStatus.SUCCESS
            for source_id in sources
        ):
            return port.name
    return None


def _topological_levels(nodes: List[GraphNode], edges: List[GraphEdge]) -> List[List[str]]:
    """
    Return deterministic execution stages; every stage waits for its predecessors.
    Deferred (t+1) edges are ignored, so a graph that is acyclic once they are
    removed still runs (and can carry values across rounds).
    """
    node_ids = {node.id for node in nodes}
    in_degree = {node.id: 0 for node in nodes}
    successors: Dict[str, List[str]] = defaultdict(list)
    for edge in edges:
        if edge.deferred:
            continue
        if edge.source_node_id in node_ids and edge.target_node_id in node_ids:
            in_degree[edge.target_node_id] += 1
            successors[edge.source_node_id].append(edge.target_node_id)

    current = [node.id for node in nodes if in_degree[node.id] == 0]
    levels: List[List[str]] = []
    visited = 0
    while current:
        level = list(current)
        levels.append(level)
        visited += len(level)
        next_level: List[str] = []
        for node_id in level:
            for successor in successors[node_id]:
                in_degree[successor] -= 1
                if in_degree[successor] == 0:
                    next_level.append(successor)
        current = [node.id for node in nodes if node.id in next_level]

    if visited != len(node_ids):
        raise ValueError("Graph contains a cycle; execution is not possible.")
    return levels


# ---------------------------------------------------------------------------
# Individual node executors
# ---------------------------------------------------------------------------

async def _execute_node(
    node: GraphNode,
    inputs: Dict[str, Any],
    effective_formats: Optional[Dict[str, Optional[str]]] = None,
) -> Dict[str, Any]:
    """Execute a single node and return its output dict."""
    element = NODE_ELEMENTS.get(node.node_type)
    if element is None:
        raise ValueError(f"Unknown node type: {node.node_type}")
    return await element.execute(node, inputs, effective_formats)


async def _execute_batch_node(node: GraphNode, inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Run AI/code once per batch item and collect their outputs as lists."""
    results = [await _execute_node(node, item) for item in batch_inputs(node, inputs)]
    return merge_batch_outputs(node, results)


# ---------------------------------------------------------------------------
# Graph executor
# ---------------------------------------------------------------------------

async def execute_graph(
    graph: Graph,
    previous_outputs: Optional[Dict[str, Dict[str, Any]]] = None,
) -> ExecutionResult:
    """
    Execute the full graph and return an ExecutionResult.

    *previous_outputs* holds the node outputs of the preceding round and is what
    deferred (t+1) edges read from; omit it for a first/standalone round.
    """
    start = time.monotonic()
    # GUI node ports are derived data; regenerate them from `config.gui_widgets`
    # before wiring/topology are inspected, so edges always see trustworthy ports.
    for node in graph.nodes:
        sync_gui_node_ports(node)
    node_map = {n.id: n for n in graph.nodes}

    try:
        levels = _topological_levels(graph.nodes, graph.edges)
    except ValueError as exc:
        return ExecutionResult(
            status=ExecutionStatus.ERROR,
            error=str(exc),
            duration_ms=(time.monotonic() - start) * 1000,
        )

    node_outputs: Dict[str, Dict[str, Any]] = {}
    node_results: List[NodeResult] = []

    result_by_id: Dict[str, NodeResult] = {}
    for level in levels:
        async def run_node(node_id: str) -> NodeResult:
            node = node_map[node_id]
            blocked_port = _blocked_required_port(node, graph.edges, result_by_id)
            if blocked_port is not None:
                return NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.SKIPPED,
                    error=f"Required input '{blocked_port}' has no available value: upstream node(s) failed",
                )

            inputs: Dict[str, Any] = {}
            node_start = time.monotonic()
            try:
                inputs = _collect_inputs(node_id, graph.edges, node_outputs, previous_outputs)
                effective_formats = _effective_input_formats(node, graph.edges, node_map)
                inputs = _resolve_file_inputs(node, inputs, effective_formats)
                source_formats = _collect_input_source_formats(node_id, graph.edges, node_map)
                inputs = _decode_node_inputs(node, inputs, effective_formats, source_formats)
                _snapshot_inputs(node, inputs)
                if node.node_type in (NodeType.AI, NodeType.CODE):
                    outputs = (
                        await _execute_node(node, inputs)
                        if node.config.batch_mode == "whole_list"
                        else await _execute_batch_node(node, inputs)
                    )
                else:
                    outputs = await _execute_node(node, inputs, effective_formats)
                outputs = _decode_node_outputs(node, outputs)
                _snapshot_outputs(node, outputs)
                return NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.SUCCESS,
                    inputs=inputs,
                    outputs=outputs,
                    duration_ms=(time.monotonic() - node_start) * 1000,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception("Error executing node %s", node_id)
                return NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.ERROR,
                    inputs=inputs,
                    error=str(exc),
                    duration_ms=(time.monotonic() - node_start) * 1000,
                )

        level_results = await asyncio.gather(*(run_node(node_id) for node_id in level))
        for result in level_results:
            result_by_id[result.node_id] = result
            if result.status == ExecutionStatus.SUCCESS:
                node_outputs[result.node_id] = result.outputs
            node_results.append(result)

    # Collect outputs of OUTPUT nodes as the final result
    final_outputs: Dict[str, Any] = {}
    for node in graph.nodes:
        if node.node_type in (NodeType.OUTPUT, NodeType.TEXT_OUTPUT) and node.id in node_outputs:
            final_outputs[node.config.output_label or node.id] = node_outputs[node.id]

    has_error = any(r.status != ExecutionStatus.SUCCESS for r in node_results)
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
    the user via a dialog before execution, output nodes flagged with
    `prompt_at_runtime`, and GUI-node file_open/directory_open widgets that have
    no preset `value`. Returns the list of values that must be supplied.
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
        elif node.node_type == NodeType.GUI:
            for widget in cfg.gui_widgets:
                if widget.value:
                    continue
                if widget.kind == GuiWidgetKind.FILE_OPEN:
                    widget_kind = "file"
                elif widget.kind == GuiWidgetKind.DIRECTORY_OPEN:
                    widget_kind = "directory"
                else:
                    continue
                requirements.append(
                    RuntimeRequirement(
                        node_id=node.id, label=widget.label or widget.id, kind=widget_kind,
                        direction="input", current_value="", widget_id=widget.id,
                    )
                )
    return requirements


def apply_runtime_values(graph: Graph, values: Dict[str, str]) -> None:
    """
    Apply resolved runtime values onto the graph in place.

    Widget-targeting convention: a key of `"{node_id}::{widget_id}"` sets the
    matching GUI node's widget `value` (used for the file_open/directory_open
    requirements returned by `get_runtime_requirements`). A plain `node_id` key
    keeps the existing behaviour of writing `node.config.value` unchanged for
    every other node type.
    """
    node_map = {n.id: n for n in graph.nodes}
    for key, value in values.items():
        node_id, sep, widget_id = key.partition("::")
        node = node_map.get(node_id)
        if node is None:
            continue
        if sep:
            widget = next((w for w in node.config.gui_widgets if w.id == widget_id), None)
            if widget is not None:
                widget.value = value
            continue
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
