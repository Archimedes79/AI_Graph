"""Shared batch-handling helpers used by the graph executor and by node elements."""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, Iterable, List, Optional

from app.models.graph import GraphNode

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# PORTABLE core -- these three functions operate on plain dicts/ids only (no
# GraphNode/Port/Pydantic types), which is what lets deploy_service.py embed
# their literal source into the compiled runner script (see extract_source in
# deploy/shared.py) instead of hand-copying a second version that can drift.
# The GraphNode-based wrappers below them are what graph_executor.py and the
# NodeElements actually call; they just resolve a node's port ids and forward.
# ---------------------------------------------------------------------------

def batch_items(inputs: Dict[str, Any], multi_port_ids: Iterable[str]) -> List[Dict[str, Any]]:
    """Expand only the declared-multi input ports into indexed items, broadcasting
    every other (scalar, or non-multi list) value unchanged into each item."""
    multi_ports = set(multi_port_ids)
    batch_size = max(
        (len(value) for key, value in inputs.items()
         if key in multi_ports and isinstance(value, list)),
        default=1,
    )
    items: List[Dict[str, Any]] = []
    for index in range(batch_size):
        item: Dict[str, Any] = {}
        for key, value in inputs.items():
            if key in multi_ports and isinstance(value, list):
                item[key] = value[index] if index < len(value) else None
            else:
                item[key] = value
        items.append(item)
    return items


def merge_batch_results(results: List[Dict[str, Any]], multi_port_ids: Iterable[str] = ()) -> Dict[str, Any]:
    """Collect one result per batch item; a single-item batch on a non-multi
    output port id keeps its scalar value instead of becoming a 1-element list."""
    multi_ports = set(multi_port_ids)
    merged: Dict[str, Any] = {}
    single = len(results) == 1
    for result in results:
        for key, value in result.items():
            is_multi = key in multi_ports
            if single and not is_multi:
                merged[key] = value
                continue
            target = merged.setdefault(key, [])
            if is_multi and isinstance(value, list):
                target.extend(value)
            else:
                target.append(value)
    return merged


def reconcile_outputs_by_ids(
    output_port_ids: Iterable[str],
    result: Dict[str, Any],
    warn: Optional[Callable[[List[Any], List[str]], None]] = None,
) -> Dict[str, Any]:
    """
    Ensure a raw dict returned by user code / AI lines up with the declared
    output port ids. If none of the keys match a declared port:
      - exactly one output port -> wrap the whole result under that port id.
      - multiple output ports -> call *warn* (if given) with (result keys,
        declared ids) and return the raw dict unchanged, to avoid crashing
        existing graphs; data may be dropped downstream.
    """
    port_ids = list(output_port_ids)
    if not result or not isinstance(result, dict) or not port_ids:
        return result
    if set(port_ids) & result.keys():
        return result
    if len(port_ids) == 1:
        return {port_ids[0]: result}
    if warn is not None:
        warn(list(result.keys()), port_ids)
    return result


# ---------------------------------------------------------------------------
# GraphNode-based wrappers -- the live-execution-side public API.
# ---------------------------------------------------------------------------

def batch_inputs(node: GraphNode, inputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Expand multi ports into indexed items while broadcasting scalar context."""
    return batch_items(inputs, (port.id for port in node.inputs if port.multi))


def reconcile_outputs(node: GraphNode, result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ensure a raw dict returned by user code / AI lines up with the node's declared
    output Port ids. If none of the keys match a declared port:
      - exactly one output port -> wrap the whole result under that port id.
      - multiple output ports -> log a warning (data may be dropped downstream)
        and return the raw dict unchanged, to avoid crashing existing graphs.
    """
    def _warn(keys: List[Any], port_ids: List[str]) -> None:
        logger.warning(
            "Node %s (%s) returned keys %s matching none of its declared output ports %s; "
            "values may be dropped downstream.",
            node.id, node.node_type, keys, sorted(port_ids),
        )

    return reconcile_outputs_by_ids([port.id for port in node.outputs], result, warn=_warn)


def merge_batch_outputs(
    node: GraphNode,
    outputs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Collect one output per batch item, flattening only multi-valued ports.

    A batch of exactly one item is not a fan-out, so a non-multi port keeps the
    scalar value instead of a 1-element list (`per_item` then matches
    `whole_list` for unbatched input).
    """
    return merge_batch_results(outputs, (port.id for port in node.outputs if port.multi))

