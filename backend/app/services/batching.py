"""Shared batch-handling helpers used by the graph executor and by node elements."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from app.models.graph import GraphNode

logger = logging.getLogger(__name__)


def batch_inputs(node: GraphNode, inputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Expand multi ports into indexed items while broadcasting scalar context."""
    multi_ports = {port.id for port in node.inputs if port.multi}
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


def reconcile_outputs(node: GraphNode, result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ensure a raw dict returned by user code / AI lines up with the node's declared
    output Port ids. If none of the keys match a declared port:
      - exactly one output port -> wrap the whole result under that port id.
      - multiple output ports -> log a warning (data may be dropped downstream)
        and return the raw dict unchanged, to avoid crashing existing graphs.
    """
    ports = node.outputs
    if not result or not isinstance(result, dict) or not ports:
        return result
    port_ids = {port.id for port in ports}
    if port_ids & result.keys():
        return result
    if len(ports) == 1:
        return {ports[0].id: result}
    logger.warning(
        "Node %s (%s) returned keys %s matching none of its declared output ports %s; "
        "values may be dropped downstream.",
        node.id, node.node_type, list(result.keys()), sorted(port_ids),
    )
    return result


def merge_batch_outputs(
    node: GraphNode,
    outputs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Collect one output per batch item, flattening only multi-valued ports.

    A batch of exactly one item is not a fan-out, so a non-multi port keeps the
    scalar value instead of a 1-element list (`per_item` then matches
    `whole_list` for unbatched input).
    """
    port_map = {port.id: port for port in node.outputs}
    single = len(outputs) == 1
    merged: Dict[str, Any] = {}
    for output in outputs:
        for key, value in output.items():
            is_multi = bool(port_map.get(key)) and port_map[key].multi
            if single and not is_multi:
                merged[key] = value
                continue
            target = merged.setdefault(key, [])
            if is_multi and isinstance(value, list):
                target.extend(value)
            else:
                target.append(value)
    return merged
