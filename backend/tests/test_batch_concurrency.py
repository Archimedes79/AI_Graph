"""
Batch execution: items run concurrently, and one failure does not discard the rest.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import ExecutionStatus, Graph  # noqa: E402
from app.services import graph_executor  # noqa: E402
from app.services.graph_executor import execute_graph  # noqa: E402

_real_execute_node = graph_executor._execute_node


def _only_for_work(fake):
    """Route 'work' to *fake* and every other node to the real executor -- the
    source node must still produce its list for the batch to have items."""
    async def dispatch(node, item, effective_formats=None):
        if node.id != "work":
            return await _real_execute_node(node, item, effective_formats)
        return await fake(node, item, effective_formats)
    return dispatch


def _graph(code: str, values: list, concurrency: int = 0) -> Graph:
    """A text input fanning `values` into one per_item code node."""
    return Graph.model_validate({
        "metadata": {"name": "batch"},
        "nodes": [
            {
                "id": "src", "node_type": "data", "label": "Source",
                "position": {"x": 0, "y": 0},
                "inputs": [],
                "outputs": [{"id": "output", "name": "Out", "kind": "output",
                             "data_type": "list", "multi": True, "required": False}],
                "config": {"data_value": values, "data_kind": "structure"},
            },
            {
                "id": "work", "node_type": "code", "label": "Work",
                "position": {"x": 200, "y": 0},
                "inputs": [{"id": "value", "name": "Value", "kind": "input",
                            "data_type": "any", "multi": True, "required": False}],
                "outputs": [{"id": "result", "name": "Result", "kind": "output",
                             "data_type": "any", "multi": True, "required": False}],
                "config": {"code": code, "language": "python",
                           "batch_mode": "per_item", "batch_concurrency": concurrency},
            },
        ],
        "edges": [{"id": "e1", "source_node_id": "src", "source_port_id": "output",
                   "target_node_id": "work", "target_port_id": "value"}],
    })


async def test_batch_items_run_concurrently(monkeypatch):
    """Six 100ms items with concurrency 6 must finish in well under six serial slots."""
    started: list[float] = []

    async def fake_execute_node(node, item, effective_formats=None):
        started.append(time.monotonic())
        await asyncio.sleep(0.1)
        return {"result": item.get("value")}

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(fake_execute_node))

    graph = _graph("", [1, 2, 3, 4, 5, 6], concurrency=6)
    began = time.monotonic()
    result = await execute_graph(graph)
    elapsed = time.monotonic() - began

    assert result.status == ExecutionStatus.SUCCESS
    assert len(started) == 6
    # Serial would be >= 0.6s; concurrent should be nearer one slot.
    assert elapsed < 0.4, f"batch did not run concurrently (took {elapsed:.2f}s)"


async def test_batch_concurrency_one_is_serial(monkeypatch):
    """A node pinned to 1 keeps the old strictly-ordered behaviour."""
    in_flight = 0
    peak = 0

    async def fake_execute_node(node, item, effective_formats=None):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.01)
        in_flight -= 1
        return {"result": item.get("value")}

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(fake_execute_node))

    await execute_graph(_graph("", [1, 2, 3, 4], concurrency=1))
    assert peak == 1


async def test_one_failed_item_keeps_the_others_and_stays_aligned(monkeypatch):
    """Item 2 of 5 fails: the node is PARTIAL, delivers the rest, and holds its
    position with None so downstream indices still line up."""
    async def fake_execute_node(node, item, effective_formats=None):
        value = item.get("value")
        if value == 3:
            raise RuntimeError("item three is bad")
        return {"result": value * 10}

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(fake_execute_node))

    result = await execute_graph(_graph("", [1, 2, 3, 4, 5], concurrency=4))
    work = next(r for r in result.node_results if r.node_id == "work")

    assert work.status == ExecutionStatus.PARTIAL
    assert work.outputs["result"] == [10, 20, None, 40, 50]
    assert "item three is bad" in work.error
    assert result.status == ExecutionStatus.PARTIAL


async def test_every_item_failing_is_still_a_node_error(monkeypatch):
    """A wholly failed batch is an ordinary failure, not a partial success."""
    async def fake_execute_node(node, item, effective_formats=None):
        raise RuntimeError("nope")

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(fake_execute_node))

    result = await execute_graph(_graph("", [1, 2, 3], concurrency=3))
    work = next(r for r in result.node_results if r.node_id == "work")

    assert work.status == ExecutionStatus.ERROR
    assert result.status == ExecutionStatus.ERROR


# ---------------------------------------------------------------------------
# Progress inside a node
# ---------------------------------------------------------------------------
#
# node_start/node_done alone make a 500-item batch one "running" node for
# twenty minutes with nothing moving -- indistinguishable from a hang.


async def test_batch_progress_is_reported_per_item(monkeypatch):
    async def fake_execute_node(node, item, effective_formats=None):
        return {"result": item.get("value")}

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(fake_execute_node))

    events: list[dict] = []
    await execute_graph(_graph("", [1, 2, 3, 4]), on_progress=events.append)

    batch = [e for e in events if e["type"] == "batch_progress"]
    assert [e["done"] for e in batch] == [0, 1, 2, 3, 4], "expected one event per item, plus the opening total"
    assert {e["total"] for e in batch} == {4}
    assert {e["node_id"] for e in batch} == {"work"}


async def test_a_failing_item_still_counts_as_finished(monkeypatch):
    """Progress must track work *completed*, not work that succeeded -- otherwise
    a batch with failures appears to stall at the first bad item."""
    async def half_failing(node, item, effective_formats=None):
        if item.get("value") == 2:
            raise RuntimeError("nope")
        return {"result": item.get("value")}

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(half_failing))

    events: list[dict] = []
    result = await execute_graph(_graph("", [1, 2, 3]), on_progress=events.append)

    assert result.status == ExecutionStatus.PARTIAL
    assert max(e["done"] for e in events if e["type"] == "batch_progress") == 3


async def test_whole_list_nodes_report_no_batch_progress(monkeypatch):
    """A whole_list node runs once; there are no items to count."""
    async def fake_execute_node(node, item, effective_formats=None):
        return {"result": item.get("value")}

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(fake_execute_node))

    graph = _graph("", [1, 2, 3])
    graph.nodes[1].config.batch_mode = "whole_list"
    events: list[dict] = []
    await execute_graph(graph, on_progress=events.append)

    assert not [e for e in events if e["type"] == "batch_progress"]


async def test_a_streaming_ai_call_reports_activity_for_its_own_node(monkeypatch):
    """The liveness ContextVar reaches ai_service from inside a node's execute,
    without any element having to pass a callback."""
    from app.services import ai_service

    async def fake_execute_node(node, item, effective_formats=None):
        report = ai_service.stream_activity.get()
        assert report is not None, "executor did not publish a liveness callback"
        report(1234)
        return {"result": item.get("value")}

    monkeypatch.setattr(graph_executor, "_execute_node", _only_for_work(fake_execute_node))

    events: list[dict] = []
    await execute_graph(_graph("", [1]), on_progress=events.append)

    activity = [e for e in events if e["type"] == "activity"]
    assert activity and activity[0]["node_id"] == "work"
    assert activity[0]["received"] == 1234
