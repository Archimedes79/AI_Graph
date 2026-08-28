"""
Graph execution engine.

Performs a topological traversal of the graph and executes each node,
passing output values along the edges to downstream node inputs.
"""

from __future__ import annotations

import os
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
    NodeResult,
    NodeType,
    RuntimeRequirement,
    sync_gui_node_ports,
)
from app.elements.registry import NODE_ELEMENTS
from app.services import ai_service, file_service  # ai_service: tests monkeypatch this module attribute
from app.services import ai_settings
from app.services.batching import batch_inputs, merge_batch_outputs

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_memory_node(node_type: NodeType) -> bool:
    """
    Node types whose output already reflects their own persisted state (a
    gui/widget node's widget `value`) rather than being freshly computed from
    this round's input. An edge feeding one of these can always be excluded
    from cycle detection/ordering -- exactly when doing so is what's needed to
    break a cycle (e.g. gui -> ai -> gui) -- because the target doesn't need
    this round's value to run: it already has its own. Once the rest of the
    round has executed, `_settle_memory_feedback` writes the freshly computed
    value into that widget's `value` so it's what the *next* round's output
    reflects. An edge into a memory node that ISN'T part of any cycle is left
    alone and still delivers same-round, e.g. a plain ai -> gui display wire.
    (A future general-purpose "memory" node type, not just gui/widget, could
    extend this same rule -- see AGENTS.md's "Memory feedback edges" section.)
    """
    return node_type in (NodeType.DATA, NodeType.GUI, NodeType.WIDGET)


def _memory_feedback_edge_ids(nodes: List[GraphNode], edges: List[GraphEdge]) -> set:
    """
    Return the ids of the minimal set of memory-node-targeting edges (see
    `_is_memory_node`) that must be excluded from topological ordering to make
    the graph acyclic. A graph with a real (non-memory) cycle still ends up
    with unresolved nodes -- the caller's own Kahn's-algorithm pass raises for
    that.
    """
    node_map = {n.id: n for n in nodes}
    node_ids = set(node_map)
    feedback_ids: set = set()

    while True:
        active = [
            e for e in edges
            if e.id not in feedback_ids and e.source_node_id in node_ids and e.target_node_id in node_ids
        ]
        in_degree = {nid: 0 for nid in node_ids}
        successors: Dict[str, List[GraphEdge]] = defaultdict(list)
        for e in active:
            in_degree[e.target_node_id] += 1
            successors[e.source_node_id].append(e)

        queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
        visited = set(queue)
        while queue:
            nid = queue.popleft()
            for e in successors[nid]:
                in_degree[e.target_node_id] -= 1
                if in_degree[e.target_node_id] == 0 and e.target_node_id not in visited:
                    visited.add(e.target_node_id)
                    queue.append(e.target_node_id)

        if len(visited) == len(node_ids):
            return feedback_ids

        candidate = next(
            (
                e for e in active
                if e.target_node_id not in visited and _is_memory_node(node_map[e.target_node_id].node_type)
            ),
            None,
        )
        if candidate is None:
            return feedback_ids  # unresolved (real) cycle; caller's own pass will raise
        feedback_ids = feedback_ids | {candidate.id}


def _collect_inputs(
    node_id: str,
    edges: List[GraphEdge],
    node_outputs: Dict[str, Dict[str, Any]],
    feedback_ids: Optional[set] = None,
) -> Dict[str, Any]:
    """
    Gather all upstream output values that are wired into *node_id*'s input ports.
    Multi-input ports accumulate values into a list. A port fed by more than one
    edge always collects as a list, even if some of its sources failed/were
    skipped -- those contribute nothing (not a `None` placeholder) so surviving
    values aren't diluted, while a single edge whose source failed still yields
    no entry at all (as opposed to a `None` value from a source that legitimately
    succeeded with `None`).

    A memory-feedback edge (its id is in *feedback_ids*, see
    `_memory_feedback_edge_ids`) contributes nothing here: its source hasn't
    run yet this round (that's what makes the graph acyclic), and its target
    already has its own persisted `value` to fall back on. `_settle_memory_feedback`
    fills it in for the *next* round once the source has actually run.
    """
    feedback_ids = feedback_ids or set()
    port_edges: Dict[str, List[GraphEdge]] = defaultdict(list)
    for edge in edges:
        if edge.target_node_id == node_id and edge.id not in feedback_ids:
            port_edges[edge.target_port_id].append(edge)

    collected: Dict[str, Any] = {}
    for target_port, incoming in port_edges.items():
        values = []
        for edge in incoming:
            source_outputs = node_outputs.get(edge.source_node_id)
            if source_outputs is None:
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


def _format_to_read_mode(fmt: Optional[str]) -> str:
    """Map a declared Port.format to file_service's read `mode` ("text"/"binary")."""
    normalized = (fmt or "").lower()
    if normalized.startswith("image/") or normalized in ("binary", "application/octet-stream"):
        return "binary"
    return "text"


def _read_one(path: str, fmt: Optional[str]) -> str:
    """Resolve a single file path to its content, honoring the declared format."""
    return file_service.read_file(path, mode=_format_to_read_mode(fmt))


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
            mode = _format_to_read_mode(fmt)
            resolved[key] = file_service.read_batch(value, mode=mode)
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


async def _settle_memory_feedback(
    node_map: Dict[str, GraphNode],
    edges: List[GraphEdge],
    feedback_ids: set,
    node_outputs: Dict[str, Dict[str, Any]],
    result_by_id: Dict[str, "NodeResult"],
) -> None:
    """
    Once every node in the round has run, write each memory-feedback edge's
    freshly computed source value into its target widget's persisted `value`
    -- what the *next* round's output reflects -- and into that widget's own
    NodeResult.inputs for this round, so the UI shows it immediately instead
    of waiting for another run. A source that didn't succeed this round
    contributes nothing (the widget keeps whatever value it already had).

    A display-only widget's transform code runs here too (the same
    `apply_display_transform` the gui element uses for same-round wires):
    when the widget ran at level 0 its feedback input hadn't arrived yet, so
    settling the raw value would mean the transform never sees fresh data.
    """
    from app.elements.gui.gui_element import apply_display_transform
    from app.models.graph import gui_widget_ports

    for edge in edges:
        if edge.id not in feedback_ids:
            continue
        source_outputs = node_outputs.get(edge.source_node_id)
        if source_outputs is None or edge.source_port_id not in source_outputs:
            continue
        value = source_outputs[edge.source_port_id]
        target_node = node_map.get(edge.target_node_id)
        if target_node is None:
            continue
        if target_node.node_type == NodeType.DATA:
            target_node.config.data_value = value
            target_result = result_by_id.get(edge.target_node_id)
            if target_result is not None:
                target_result.inputs[edge.target_port_id] = value
            continue
        widget_id = edge.target_port_id[:-3] if edge.target_port_id.endswith("_in") else edge.target_port_id
        widget = next((w for w in target_node.config.gui_widgets if w.id == widget_id), None)
        if widget is None:
            continue
        _, widget_outputs = gui_widget_ports(widget)
        if not widget_outputs:
            value = await apply_display_transform(widget, value)
        widget.value = value
        target_result = result_by_id.get(edge.target_node_id)
        if target_result is not None:
            target_result.inputs[edge.target_port_id] = value


def _blocked_port(
    node: GraphNode,
    edges: List[GraphEdge],
    result_by_id: Dict[str, "NodeResult"],
    feedback_ids: Optional[set] = None,
) -> Optional[str]:
    """
    Return the name of a WIRED input port whose predecessors have ALL
    failed/been skipped (i.e. no successful source remains for that port), or
    None if every wired port is still satisfiable. Ports that aren't wired to
    any edge are never blocking — optional means "may be unwired", but a port
    the user *did* wire is expected to deliver: running anyway would hand the
    element an inputs dict with the key silently missing, which surfaces as a
    confusing KeyError inside user code instead of a clean skip.
    Memory-feedback edges (see `_memory_feedback_edge_ids`) are ignored: their
    source hasn't run yet this round and the target already has its own
    persisted value to fall back on.
    """
    feedback_ids = feedback_ids or set()
    incoming_by_port: Dict[str, List[str]] = defaultdict(list)
    for edge in edges:
        if edge.target_node_id == node.id and edge.id not in feedback_ids:
            incoming_by_port[edge.target_port_id].append(edge.source_node_id)

    for port in node.inputs:
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
    Memory-feedback edges (see `_memory_feedback_edge_ids`) are ignored, so a
    graph that is acyclic once they are removed still runs.
    """
    feedback_ids = _memory_feedback_edge_ids(nodes, edges)
    node_ids = {node.id for node in nodes}
    in_degree = {node.id: 0 for node in nodes}
    successors: Dict[str, List[str]] = defaultdict(list)
    for edge in edges:
        if edge.id in feedback_ids:
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


DEFAULT_BATCH_CONCURRENCY = max(1, int(os.getenv("AI_GRAPH_BATCH_CONCURRENCY", "4")))


async def _execute_batch_node(node: GraphNode, inputs: Dict[str, Any]) -> tuple[Dict[str, Any], List[str]]:
    """
    Run AI/code once per batch item, concurrently, and collect their outputs as
    lists. Returns the merged outputs plus one message per failed item.

    Two deliberate behaviours, both learned from long batches:

    - **Items run in parallel**, bounded by the node's `batch_concurrency` (or
      AI_GRAPH_BATCH_CONCURRENCY). This used to be a sequential `await` per item,
      which made a 2,000-item AI batch take hours of almost entirely idle
      wall-clock. Set the node's concurrency to 1 to get the old behaviour where
      a provider rate-limits or order matters.
    - **One failed item does not discard the rest.** A raising item contributes
      `None` on every declared output port -- keeping the batch index-aligned
      with its input, so item 5's output stays item 5's -- and its error is
      returned for the caller to report as a PARTIAL result.
    """
    items = batch_inputs(node, inputs)
    limit = node.config.batch_concurrency or DEFAULT_BATCH_CONCURRENCY
    semaphore = asyncio.Semaphore(max(1, limit))
    empty = {port.id: None for port in node.outputs}

    async def run_item(index: int, item: Dict[str, Any]):
        async with semaphore:
            try:
                return await _execute_node(node, item)
            except Exception as exc:  # noqa: BLE001 - reported, not swallowed
                logger.warning("Batch item %d of node %s failed: %s", index, node.id, exc)
                return exc

    settled = await asyncio.gather(*(run_item(i, item) for i, item in enumerate(items)))

    outputs: List[Dict[str, Any]] = []
    errors: List[str] = []
    for index, result in enumerate(settled):
        if isinstance(result, Exception):
            errors.append(f"item {index}: {result}")
            outputs.append(dict(empty))
        else:
            outputs.append(result)

    # Every item failed: that is an ordinary node failure, not a partial result.
    if items and len(errors) == len(items):
        raise RuntimeError(f"all {len(items)} batch items failed; first error -- {errors[0].split(': ', 1)[-1]}")

    return merge_batch_outputs(node, outputs), errors


# ---------------------------------------------------------------------------
# Graph executor
# ---------------------------------------------------------------------------

async def execute_graph(
    graph: Graph,
) -> ExecutionResult:
    """
    Execute the full graph and return an ExecutionResult.
    """
    start = time.monotonic()
    # Publish the graph's own AI default (metadata.ai_defaults) for this run, so
    # an `ai` node configured as AIProvider.DEFAULT resolves to it -- unless the
    # environment, an ai-settings.json, or a CLI/UI override takes precedence
    # (see app.services.ai_settings). It lives here rather than in the AI
    # element because an element never sees the graph it belongs to.
    ai_settings.set_graph_defaults(
        str(getattr(graph.metadata.ai_defaults.provider, "value", graph.metadata.ai_defaults.provider) or ""),
        graph.metadata.ai_defaults.model,
    )
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
    feedback_ids = _memory_feedback_edge_ids(graph.nodes, graph.edges)

    node_outputs: Dict[str, Dict[str, Any]] = {}
    node_results: List[NodeResult] = []

    result_by_id: Dict[str, NodeResult] = {}
    for level in levels:
        async def run_node(node_id: str) -> NodeResult:
            node = node_map[node_id]
            blocked_port = _blocked_port(node, graph.edges, result_by_id, feedback_ids)
            if blocked_port is not None:
                return NodeResult(
                    node_id=node_id,
                    status=ExecutionStatus.SKIPPED,
                    error=f"Input '{blocked_port}' has no available value: upstream node(s) failed or were skipped",
                )

            inputs: Dict[str, Any] = {}
            item_errors: List[str] = []
            node_start = time.monotonic()
            try:
                inputs = _collect_inputs(node_id, graph.edges, node_outputs, feedback_ids)
                effective_formats = _effective_input_formats(node, graph.edges, node_map)
                inputs = _resolve_file_inputs(node, inputs, effective_formats)
                source_formats = _collect_input_source_formats(node_id, graph.edges, node_map)
                inputs = _decode_node_inputs(node, inputs, effective_formats, source_formats)
                _snapshot_inputs(node, inputs)
                if node.node_type in (NodeType.AI, NodeType.CODE):
                    if node.config.batch_mode == "whole_list":
                        outputs = await _execute_node(node, inputs)
                    else:
                        outputs, item_errors = await _execute_batch_node(node, inputs)
                else:
                    outputs = await _execute_node(node, inputs, effective_formats)
                outputs = _decode_node_outputs(node, outputs)
                _snapshot_outputs(node, outputs)
                return NodeResult(
                    node_id=node_id,
                    # Some batch items failed but others produced values: deliver
                    # them downstream and report what was lost, rather than
                    # discarding a long run's work over one bad item.
                    status=ExecutionStatus.PARTIAL if item_errors else ExecutionStatus.SUCCESS,
                    inputs=inputs,
                    outputs=outputs,
                    error=(
                        f"{len(item_errors)} batch item(s) failed: " + "; ".join(item_errors[:5])
                        if item_errors else None
                    ),
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
            # PARTIAL counts as delivering: its outputs are real, with None at the
            # positions whose items failed. Excluding them here would skip every
            # downstream node over a single bad batch item.
            if result.status in (ExecutionStatus.SUCCESS, ExecutionStatus.PARTIAL):
                node_outputs[result.node_id] = result.outputs
            node_results.append(result)

    await _settle_memory_feedback(node_map, graph.edges, feedback_ids, node_outputs, result_by_id)

    # Collect outputs of OUTPUT nodes as the final result
    final_outputs: Dict[str, Any] = {}
    for node in graph.nodes:
        if node.node_type == NodeType.OUTPUT and node.id in node_outputs:
            final_outputs[node.config.output_label or node.id] = node_outputs[node.id]

    # A run where every node either succeeded or delivered a partial batch is not
    # a failure -- it produced output. It is reported as PARTIAL so the caller can
    # say so, and only a real error/skip makes the whole run an error.
    has_error = any(r.status in (ExecutionStatus.ERROR, ExecutionStatus.SKIPPED) for r in node_results)
    has_partial = any(r.status == ExecutionStatus.PARTIAL for r in node_results)
    overall = (
        ExecutionStatus.ERROR if has_error
        else ExecutionStatus.PARTIAL if has_partial
        else ExecutionStatus.SUCCESS
    )
    return ExecutionResult(
        status=overall,
        node_results=node_results,
        final_outputs=final_outputs,
        duration_ms=(time.monotonic() - start) * 1000,
    )


# ---------------------------------------------------------------------------
# Runtime prompting – used by the web UI (via requirements + manual apply),
# the graph-runner CLI, and the generated deployment runner script.
# ---------------------------------------------------------------------------

def get_runtime_requirements(graph: Graph) -> List[RuntimeRequirement]:
    """
    Inspect the graph for input nodes flagged with `prompt_at_runtime` (which
    prompt the user via a dialog before execution), output nodes flagged the
    same way, and GUI-node picker widgets that have no preset `value`. Returns
    the list of values that must be supplied.

    Delegates per-node-type/per-widget-kind logic to each element's
    `runtime_requirements`, the same method `deploy_service._requirements_txt`
    dispatches through, so the editor and the compiled deploy bundle can never
    disagree on which nodes/widgets prompt at runtime.
    """
    requirements: List[RuntimeRequirement] = []
    for node in graph.nodes:
        element = NODE_ELEMENTS.get(node.node_type)
        if element is None:
            continue
        for req in element.runtime_requirements(node):
            requirements.append(RuntimeRequirement(**req))
    return requirements


def apply_runtime_values(graph: Graph, values: Dict[str, str]) -> None:
    """
    Apply resolved runtime values onto the graph in place.

    Widget-targeting convention: a key of `"{node_id}::{widget_id}"` sets the
    matching GUI node's widget `value` (used for the input_picker
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
    Collect the rendered content of every `output` node with
    `config.write_mode == "window"` so it can be shown to the user (web modal,
    or printed to the console for CLI/deployed runs).
    """
    results_by_id = {r.node_id: r for r in result.node_results}
    windows: List[Dict[str, str]] = []
    for node in graph.nodes:
        if node.node_type != NodeType.OUTPUT or node.config.write_mode != "window":
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
